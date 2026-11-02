import { createHash } from 'node:crypto'
import { EmbedderResponseError, EmbedderUnavailableError } from '@wefaber/embed'
import type { Embedder } from './ai/embedder.ts'
import {
  MAX_CHUNKS_PER_TEAM,
  MAX_SOURCES_PER_TEAM,
  type ChunkIn,
  type FileIn,
  type Knowledge,
  type Source,
} from './db/knowledge.ts'
import {
  RepoImportError,
  targetOf,
  type RepoImporter,
  type RepoSpec,
} from './repo-import.ts'

const PARALLEL = 4
/** The query embedding gets this long; past it the search answers with the lexical ranking alone. */
const SEMANTIC_WAIT_MS = 1500

/**
 * Splits a document into overlapping pieces that end on a paragraph or sentence when they can.
 * Lifted from eternum-board (`build/index.ts`).
 */
export function chunkText(
  text: string,
  size = 1200,
  overlap = 200,
  max = 80,
): string[] {
  const clean = text.replace(/\n{3,}/g, '\n\n').trim()
  if (!clean) return []
  const out: string[] = []
  let start = 0
  while (start < clean.length && out.length < max) {
    let end = Math.min(clean.length, start + size)
    if (end < clean.length) {
      const cut = Math.max(
        clean.lastIndexOf('\n\n', end),
        clean.lastIndexOf('. ', end),
        clean.lastIndexOf('\n', end),
      )
      if (cut > start + size * 0.5) end = cut + 1
    }
    const piece = clean.slice(start, end).trim()
    if (piece.length > 40) out.push(piece)
    if (end >= clean.length) break
    start = Math.max(end - overlap, start + 1)
  }
  return out
}

const sha1 = (...parts: string[]) => {
  const h = createHash('sha1')
  for (const p of parts) h.update(p)
  return h.digest('hex')
}

/** `docs/arquitectura.md` -> `arquitectura`: the title the embedder sees in front of each chunk. */
export const titleOf = (path: string) =>
  (path.split('/').pop() ?? path)
    .replace(/\.[^.]+$/, '')
    .replaceAll(/[-_]+/g, ' ')

const toBytes = (v: Float32Array) =>
  new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength))

const fromBytes = (b: Uint8Array) => new Float32Array(Uint8Array.from(b).buffer)

const looksBinary = (bytes: Uint8Array) => bytes.subarray(0, 4096).includes(0)

const embedderFailure = (e: unknown) =>
  e instanceof EmbedderUnavailableError || e instanceof EmbedderResponseError

export interface SyncResult {
  source: Source
  added: number
  updated: number
  removed: number
  unchanged: number
  /** The embedder is configured but could not be reached: the new text is searchable by words only. */
  embedderDown: boolean
}

export interface SyncDeps {
  knowledge: Knowledge
  importer: RepoImporter
  embedder: Embedder | null
}

/**
 * Brings a source (repo folder at a ref) up to date: fetches only the files whose blob changed, chunks them, embeds
 * the chunks it has not seen, and writes everything in one transaction. The first call creates the source; calling
 * again is a re-sync. Repo content is data: it is stored and searched, never followed.
 */
export async function syncRepo(
  { knowledge, importer, embedder }: SyncDeps,
  userId: string,
  teamId: string,
  spec: RepoSpec,
): Promise<SyncResult> {
  knowledge.requireMember(teamId, userId)
  const target = targetOf(spec, importer.org)
  const existing = knowledge.findSource(teamId, target)
  if (!existing && knowledge.sourceCount(teamId) >= MAX_SOURCES_PER_TEAM) {
    throw new RepoImportError(
      400,
      `Cada equipo puede tener hasta ${MAX_SOURCES_PER_TEAM} fuentes.`,
    )
  }

  const tree = await importer.tree(target)
  const had: ReturnType<Knowledge['files']> = existing
    ? knowledge.files(existing.id)
    : new Map()
  const current = new Set(tree.entries.map((e) => e.path))
  const changed = tree.entries.filter((e) => had.get(e.path)?.blobSha !== e.sha)
  const removed = [...had.keys()].filter((p) => !current.has(p))
  const dropped = new Set([...removed, ...changed.map((e) => e.path)])

  const files: FileIn[] = []
  for (let i = 0; i < changed.length; i += PARALLEL) {
    const batch = await Promise.all(
      changed.slice(i, i + PARALLEL).map(async (entry) => {
        const bytes = await importer.read(target, entry.path)
        const texts = looksBinary(bytes)
          ? []
          : chunkText(new TextDecoder().decode(bytes))
        const chunks: ChunkIn[] = texts.map((text, idx) => ({
          idx,
          text,
          hash: sha1(titleOf(entry.path), '\n', text),
          model: null,
          emb: null,
        }))
        return { path: entry.path, blobSha: entry.sha, chunks }
      }),
    )
    files.push(...batch)
  }

  const kept = [...had.entries()]
    .filter(([path]) => !dropped.has(path))
    .reduce((n, [, f]) => n + f.chunks, 0)
  const fresh = files.reduce((n, f) => n + f.chunks.length, 0)
  const others = knowledge.chunkCount(teamId) - (existing?.chunkCount ?? 0)
  if (others + kept + fresh > MAX_CHUNKS_PER_TEAM) {
    throw new RepoImportError(
      400,
      `Eso pasa el máximo de ${MAX_CHUNKS_PER_TEAM} fragmentos por equipo. Elegí una carpeta más específica o quitá otra fuente.`,
    )
  }

  let embedderDown = false
  const backfill: { id: number; model: string; emb: Uint8Array }[] = []
  if (embedder) {
    const all = files.flatMap((f) =>
      f.chunks.map((chunk) => ({ path: f.path, chunk })),
    )
    const reuse = knowledge.reusable(
      teamId,
      all.map((a) => a.chunk.hash),
      embedder.model,
    )
    const need: typeof all = []
    for (const a of all) {
      const emb = reuse.get(a.chunk.hash)
      if (emb) {
        a.chunk.emb = emb
        a.chunk.model = embedder.model
      } else need.push(a)
    }
    // Chunks an earlier sync left without a vector (embedder was down): they get one now.
    const late = existing
      ? knowledge
          .unembedded(existing.id, embedder.model)
          .filter((r) => !dropped.has(r.path))
      : []
    const jobs = [
      ...need.map((n) => ({ title: titleOf(n.path), text: n.chunk.text })),
      ...late.map((r) => ({ title: titleOf(r.path), text: r.text })),
    ]
    if (jobs.length > 0) {
      try {
        const vectors = await embedder.docs(jobs)
        need.forEach((n, i) => {
          n.chunk.emb = toBytes(vectors[i]!)
          n.chunk.model = embedder.model
        })
        late.forEach((r, i) =>
          backfill.push({
            id: r.id,
            model: embedder.model,
            emb: toBytes(vectors[need.length + i]!),
          }),
        )
      } catch (e) {
        if (!embedderFailure(e)) throw e
        embedderDown = true
      }
    }
  }

  if (
    existing &&
    existing.treeSha === tree.treeSha &&
    files.length === 0 &&
    removed.length === 0 &&
    backfill.length === 0
  ) {
    return {
      source: existing,
      added: 0,
      updated: 0,
      removed: 0,
      unchanged: tree.entries.length,
      embedderDown,
    }
  }

  const source = knowledge.apply({
    teamId,
    userId,
    spec: target,
    treeSha: tree.treeSha,
    files,
    removed,
    backfill,
    fileCount: tree.entries.length,
  })
  return {
    source,
    added: files.filter((f) => !had.has(f.path)).length,
    updated: files.filter((f) => had.has(f.path)).length,
    removed: removed.length,
    unchanged: tree.entries.length - files.length,
    embedderDown,
  }
}

/* --- Search ----------------------------------------------------------------------------------------------------- */

export interface Hit {
  id: number
  path: string
  text: string
  score: number
  via: 'words' | 'meaning' | 'both'
}

/** Reciprocal-rank fusion: a robust way to merge a lexical and a semantic ranking (from eternum-board). */
export function fuse(lists: number[][], k = 60): Map<number, number> {
  const score = new Map<number, number>()
  for (const list of lists) {
    list.forEach((id, i) =>
      score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1)),
    )
  }
  return score
}

/** A safe FTS5 expression from free text: quoted prefix terms joined with OR. Empty when no usable word. */
export function ftsMatch(query: string): string {
  const words = new Set(query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])
  return [...words]
    .slice(0, 12)
    .map((w) => `"${w}"*`)
    .join(' OR ')
}

const settleWithin = <T>(p: Promise<T>, ms: number): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  return Promise.race([p, late]).finally(() => clearTimeout(timer))
}

export interface SearchDeps {
  knowledge: Knowledge
  embedder: Embedder | null
}

/**
 * What the team's indexed sources say about `query`: FTS5 (bm25) fused with cosine similarity when the embedder
 * answers in time. At most `perFile` passages per file, so one long document cannot take every slot.
 */
export async function searchKnowledge(
  { knowledge, embedder }: SearchDeps,
  userId: string,
  teamId: string,
  query: string,
  limit = 8,
  perFile = 2,
): Promise<{ semantic: boolean; hits: Hit[] }> {
  const q = query.trim().slice(0, 300)
  knowledge.requireMember(teamId, userId)
  if (!q) return { semantic: false, hits: [] }

  const lexical = knowledge.lexical(userId, teamId, ftsMatch(q), 40)
  const byId = new Map(lexical.map((p) => [p.id, p]))

  let meaning: number[] = []
  let semantic = false
  if (embedder) {
    const qv = await settleWithin(
      embedder.query(q).catch((e: unknown) => {
        if (!embedderFailure(e)) throw e
        return null
      }),
      SEMANTIC_WAIT_MS,
    )
    if (qv) {
      semantic = true
      const scored = knowledge
        .vectors(userId, teamId, embedder.model)
        .flatMap((row) => {
          const v = fromBytes(row.emb)
          if (v.length !== qv.length) return []
          let dot = 0
          for (let i = 0; i < v.length; i++) dot += v[i]! * qv[i]!
          byId.set(row.id, row)
          return [{ id: row.id, dot }]
        })
        .toSorted((a, b) => b.dot - a.dot)
        .slice(0, 40)
      meaning = scored.map((s) => s.id)
    }
  }

  const words = new Set(lexical.map((p) => p.id))
  const sem = new Set(meaning)
  const fused = fuse([lexical.map((p) => p.id), meaning])
  const taken = new Map<string, number>()
  const hits: Hit[] = []
  for (const [id, score] of [...fused.entries()].toSorted(
    (a, b) => b[1] - a[1],
  )) {
    const p = byId.get(id)!
    if ((taken.get(p.path) ?? 0) >= perFile) continue
    taken.set(p.path, (taken.get(p.path) ?? 0) + 1)
    hits.push({
      id,
      path: p.path,
      text: p.text,
      score,
      via:
        words.has(id) && sem.has(id)
          ? 'both'
          : sem.has(id)
            ? 'meaning'
            : 'words',
    })
    if (hits.length >= limit) break
  }
  return { semantic, hits }
}

const ROLE_QUERIES = [
  'integrantes del equipo roles coordinador miembro',
  'encargado de responsable de frontend backend',
  'reparto de roles presentadores defensa',
  'equipo integrantes nombres',
]

/** Passages most likely to say who is on the team and what each one does, one query after another, no repeats. */
export async function rolePassages(
  deps: SearchDeps,
  userId: string,
  teamId: string,
  limit = 14,
): Promise<{ path: string; text: string }[]> {
  const lists = await Promise.all(
    ROLE_QUERIES.map((q) => searchKnowledge(deps, userId, teamId, q, 6)),
  )
  const seen = new Set<number>()
  const out: { path: string; text: string }[] = []
  for (
    let i = 0;
    out.length < limit && lists.some((l) => i < l.hits.length);
    i++
  ) {
    for (const list of lists) {
      const hit = list.hits[i]
      if (!hit || seen.has(hit.id) || out.length >= limit) continue
      seen.add(hit.id)
      out.push({ path: hit.path, text: hit.text })
    }
  }
  return out
}
