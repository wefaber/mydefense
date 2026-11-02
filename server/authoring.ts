import {
  authorOutline,
  authorPoint,
  type Draft,
  type DraftPoint,
  type OutlinePoint,
  type Passage,
} from './ai/author.ts'
import type { Embedder } from './ai/embedder.ts'
import type { Llm } from './ai/llm.ts'
import type { Authoring, GenerationRun } from './db/authoring.ts'
import type { Catalog } from './db/catalog.ts'
import type { Knowledge } from './db/knowledge.ts'
import { searchKnowledge } from './knowledge.ts'

/** Files listed to the outline stage: a long repo is read by its first files only. */
const OUTLINE_FILES = 300
const PARALLEL = 3
const CHUNKS_PER_FILE = 4
const PASSAGES_PER_POINT = 14
/** Everything one point sends to the model stays under this many characters. */
const POINT_CHARS = 16_000

export interface AuthoringDeps {
  authoring: Authoring
  knowledge: Knowledge
  catalog: Catalog
  llm: Llm
  embedder: Embedder | null
}

/** What the model reads for one point: the opening of the files it rests on, then what the index finds by its title. */
async function pointPassages(
  deps: AuthoringDeps,
  userId: string,
  teamId: string,
  point: OutlinePoint,
): Promise<Passage[]> {
  const own = deps.knowledge.chunksOf(
    userId,
    teamId,
    point.paths,
    CHUNKS_PER_FILE,
  )
  const found = await searchKnowledge(
    { knowledge: deps.knowledge, embedder: deps.embedder },
    userId,
    teamId,
    point.title,
    4,
  )
  const seen = new Set<string>()
  const out: Passage[] = []
  let chars = 0
  for (const p of [...own, ...found.hits]) {
    const key = `${p.path}\n${p.text}`
    if (seen.has(key)) continue
    if (out.length >= PASSAGES_PER_POINT || chars + p.text.length > POINT_CHARS)
      break
    seen.add(key)
    out.push({ path: p.path, text: p.text })
    chars += p.text.length
  }
  return out
}

/** A point the model could not prepare keeps its place, empty and marked for the team to complete. */
const emptyPoint = (p: OutlinePoint): DraftPoint => ({
  code: p.code,
  title: p.title,
  owner: p.owner,
  refs: p.paths,
  script: '',
  say: [],
  status: 'fill',
  todo: 'No pudimos preparar este punto: completalo con el equipo.',
  questions: [],
})

/**
 * The whole generation for one run: outline first, then each point on its own call (3 at a time), progress written
 * as it goes. Never throws: any failure ends the run as `failed` with a message. Exported so tests can await it.
 */
export async function runGeneration(
  deps: AuthoringDeps,
  userId: string,
  teamId: string,
  runId: string,
): Promise<void> {
  const { authoring, knowledge, catalog, llm } = deps
  try {
    const heads = knowledge.heads(userId, teamId, OUTLINE_FILES)
    const people = catalog.identities(teamId).map((i) => ({
      key: i.key,
      name: i.name,
      role: i.role,
      sectors: i.sectors,
    }))
    const outline = await authorOutline(llm, heads, people)
    if (outline.length === 0) {
      authoring.fail(runId, 'No pudimos armar un índice con ese material.')
      return
    }

    const jobs = outline.flatMap((s) => s.points)
    authoring.progress(runId, { phase: 'points', total: jobs.length, done: 0 })
    const prepared = new Map<string, DraftPoint>()
    let done = 0
    let failed = 0
    let next = 0
    const worker = async () => {
      for (let i = next++; i < jobs.length; i = next++) {
        const point = jobs[i]!
        try {
          const passages = await pointPassages(deps, userId, teamId, point)
          prepared.set(point.code, await authorPoint(llm, point, passages))
        } catch {
          failed++
          prepared.set(point.code, emptyPoint(point))
        }
        authoring.progress(runId, {
          phase: 'points',
          total: jobs.length,
          done: ++done,
        })
      }
    }
    await Promise.all(Array.from({ length: PARALLEL }, worker))

    if (failed === jobs.length) {
      authoring.fail(
        runId,
        'El modelo no respondió. Probá de nuevo en un rato.',
      )
      return
    }
    const draft: Draft = {
      sections: outline.map((s) => ({
        number: s.number,
        title: s.title,
        points: s.points.map((p) => prepared.get(p.code)!),
      })),
    }
    authoring.finish(runId, draft)
  } catch (e) {
    authoring.fail(
      runId,
      e instanceof Error ? e.message : 'Falló la generación.',
    )
  }
}

/** Opens the run and returns at once; the work goes on in the background and the run row reports it. */
export function startGeneration(
  deps: AuthoringDeps,
  userId: string,
  teamId: string,
): GenerationRun {
  const run = deps.authoring.start(userId, teamId)
  void runGeneration(deps, userId, teamId, run.id)
  return run
}
