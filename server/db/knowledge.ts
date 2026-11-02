import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import type { Role } from '../../shared/types.ts'
import type { Db } from './connection.ts'
import * as t from './schema.ts'
import { AccessError } from './workspace.ts'

export const MAX_SOURCES_PER_TEAM = 10
export const MAX_FILES_PER_SOURCE = 500
export const MAX_CHUNKS_PER_TEAM = 6000

export type Source = typeof t.sources.$inferSelect

export interface SourceSpec {
  repo: string
  folder: string
  ref: string
}

export interface ChunkIn {
  idx: number
  text: string
  hash: string
  model: string | null
  emb: Uint8Array | null
}

export interface FileIn {
  path: string
  blobSha: string
  chunks: ChunkIn[]
}

export interface SyncWrite {
  teamId: string
  userId: string
  spec: SourceSpec
  treeSha: string
  /** Files to (re)write: new or changed. Their old chunks are dropped first. */
  files: FileIn[]
  /** Paths that no longer exist in the source. */
  removed: string[]
  /** Embeddings for chunks that were left without one by an earlier sync (id -> vector). */
  backfill: { id: number; model: string; emb: Uint8Array }[]
  /** Files of the source after this sync. */
  fileCount: number
}

export interface Passage {
  id: number
  path: string
  text: string
}

export interface VectorRow extends Passage {
  emb: Uint8Array
}

/**
 * Everything about what a team has indexed: sources, their files and chunks, the FTS5 index over the chunks and
 * the stored vectors. Every method that takes a user checks their role first, like `Workspace`.
 */
export class Knowledge {
  private readonly db: Db
  private readonly now: () => Date

  constructor(db: Db, now: () => Date = () => new Date()) {
    this.db = db
    this.now = now
  }

  private roleOf(teamId: string, userId: string): Role | null {
    return (
      this.db
        .select({ role: t.members.role })
        .from(t.members)
        .where(and(eq(t.members.teamId, teamId), eq(t.members.userId, userId)))
        .get()?.role ?? null
    )
  }

  requireMember(teamId: string, userId: string): Role {
    const role = this.roleOf(teamId, userId)
    if (!role) throw new AccessError('NOT_FOUND', 'No encontramos ese equipo.')
    return role
  }

  /* --- Reads ---------------------------------------------------------------------------------------------- */

  sources(userId: string, teamId: string): Source[] {
    this.requireMember(teamId, userId)
    return this.db
      .select()
      .from(t.sources)
      .where(eq(t.sources.teamId, teamId))
      .orderBy(asc(t.sources.repo), asc(t.sources.folder))
      .all()
  }

  findSource(teamId: string, spec: SourceSpec): Source | undefined {
    return this.db
      .select()
      .from(t.sources)
      .where(
        and(
          eq(t.sources.teamId, teamId),
          eq(t.sources.repo, spec.repo),
          eq(t.sources.folder, spec.folder),
          eq(t.sources.ref, spec.ref),
        ),
      )
      .get()
  }

  sourceCount(teamId: string): number {
    return this.db
      .select({ id: t.sources.id })
      .from(t.sources)
      .where(eq(t.sources.teamId, teamId))
      .all().length
  }

  chunkCount(teamId: string): number {
    return this.db
      .select({ id: t.chunks.id })
      .from(t.chunks)
      .where(eq(t.chunks.teamId, teamId))
      .all().length
  }

  /** path -> blob sha and chunk count of what a source already holds. */
  files(sourceId: string): Map<string, { blobSha: string; chunks: number }> {
    return new Map(
      this.db
        .select()
        .from(t.sourceFiles)
        .where(eq(t.sourceFiles.sourceId, sourceId))
        .all()
        .map((r) => [r.path, { blobSha: r.blobSha, chunks: r.chunks }]),
    )
  }

  /** Embeddings the team already has for these chunk hashes, so an unchanged chunk is never embedded twice. */
  reusable(
    teamId: string,
    hashes: string[],
    model: string,
  ): Map<string, Uint8Array> {
    const out = new Map<string, Uint8Array>()
    for (let i = 0; i < hashes.length; i += 400) {
      const rows = this.db
        .select({ hash: t.chunks.hash, emb: t.chunks.emb })
        .from(t.chunks)
        .where(
          and(
            eq(t.chunks.teamId, teamId),
            eq(t.chunks.model, model),
            inArray(t.chunks.hash, hashes.slice(i, i + 400)),
          ),
        )
        .all()
      for (const r of rows) if (r.emb) out.set(r.hash, r.emb)
    }
    return out
  }

  /** Chunks of a source with no embedding for `model` (the embedder was off or down when they were written). */
  unembedded(sourceId: string, model: string) {
    return this.db
      .select({
        id: t.chunks.id,
        path: t.chunks.path,
        text: t.chunks.text,
        hash: t.chunks.hash,
      })
      .from(t.chunks)
      .where(
        and(
          eq(t.chunks.sourceId, sourceId),
          sql`(${t.chunks.emb} IS NULL OR ${t.chunks.model} IS NOT ${model})`,
        ),
      )
      .all()
  }

  /** FTS5 matches, best first (bm25). `match` is an already-sanitised FTS5 expression. */
  lexical(
    userId: string,
    teamId: string,
    match: string,
    limit: number,
  ): Passage[] {
    this.requireMember(teamId, userId)
    if (!match) return []
    return this.db.all<Passage>(sql`
      SELECT c.id AS id, c.path AS path, c.text AS text
      FROM chunks_fts
      JOIN chunks c ON c.id = chunks_fts.rowid
      WHERE chunks_fts MATCH ${match} AND c.team_id = ${teamId}
      ORDER BY bm25(chunks_fts)
      LIMIT ${limit}`)
  }

  /** Every embedded chunk of the team for `model`, to rank by cosine in memory. */
  vectors(userId: string, teamId: string, model: string): VectorRow[] {
    this.requireMember(teamId, userId)
    return this.db
      .select({
        id: t.chunks.id,
        path: t.chunks.path,
        text: t.chunks.text,
        emb: t.chunks.emb,
      })
      .from(t.chunks)
      .where(
        and(
          eq(t.chunks.teamId, teamId),
          eq(t.chunks.model, model),
          sql`${t.chunks.emb} IS NOT NULL`,
        ),
      )
      .all() as VectorRow[]
  }

  /** The start of every file of the team's sources, in path order: a map of what the documentation covers. */
  heads(userId: string, teamId: string, limit: number) {
    this.requireMember(teamId, userId)
    return this.db
      .select({ path: t.chunks.path, head: t.chunks.text })
      .from(t.chunks)
      .where(and(eq(t.chunks.teamId, teamId), eq(t.chunks.idx, 0)))
      .orderBy(asc(t.chunks.path))
      .limit(limit)
      .all()
      .map((r) => ({ path: r.path, head: r.head.slice(0, 160) }))
  }

  /** The first `perFile` chunks of each of the given files. */
  chunksOf(
    userId: string,
    teamId: string,
    paths: string[],
    perFile: number,
  ): { path: string; text: string }[] {
    this.requireMember(teamId, userId)
    if (paths.length === 0) return []
    return this.db
      .select({ path: t.chunks.path, text: t.chunks.text })
      .from(t.chunks)
      .where(
        and(
          eq(t.chunks.teamId, teamId),
          inArray(t.chunks.path, paths),
          sql`${t.chunks.idx} < ${perFile}`,
        ),
      )
      .orderBy(asc(t.chunks.path), asc(t.chunks.idx))
      .all()
  }

  /* --- Writes --------------------------------------------------------------------------------------------- */

  /** Applies one sync atomically: the rows, the FTS index and the counters change together or not at all. */
  apply(write: SyncWrite): Source {
    const stamp = this.now().toISOString()
    return this.db.transaction((tx) => {
      let source = this.findSource(write.teamId, write.spec)
      if (!source) {
        source = tx
          .insert(t.sources)
          .values({
            id: ulid(),
            teamId: write.teamId,
            kind: 'github',
            repo: write.spec.repo,
            folder: write.spec.folder,
            ref: write.spec.ref,
            treeSha: write.treeSha,
            fileCount: 0,
            chunkCount: 0,
            embeddedCount: 0,
            createdBy: write.userId,
            createdAt: stamp,
            syncedAt: stamp,
          })
          .returning()
          .get()
      }
      const sourceId = source.id

      const drop = [...write.removed, ...write.files.map((f) => f.path)]
      for (let i = 0; i < drop.length; i += 400) {
        const paths = drop.slice(i, i + 400)
        const ids = tx
          .select({ id: t.chunks.id })
          .from(t.chunks)
          .where(
            and(eq(t.chunks.sourceId, sourceId), inArray(t.chunks.path, paths)),
          )
          .all()
          .map((r) => r.id)
        for (const id of ids)
          tx.run(sql`DELETE FROM chunks_fts WHERE rowid = ${id}`)
        tx.delete(t.chunks)
          .where(
            and(eq(t.chunks.sourceId, sourceId), inArray(t.chunks.path, paths)),
          )
          .run()
        tx.delete(t.sourceFiles)
          .where(
            and(
              eq(t.sourceFiles.sourceId, sourceId),
              inArray(t.sourceFiles.path, paths),
            ),
          )
          .run()
      }

      for (const file of write.files) {
        tx.insert(t.sourceFiles)
          .values({
            sourceId,
            path: file.path,
            blobSha: file.blobSha,
            chunks: file.chunks.length,
          })
          .run()
        for (const chunk of file.chunks) {
          const row = tx
            .insert(t.chunks)
            .values({
              teamId: write.teamId,
              sourceId,
              path: file.path,
              idx: chunk.idx,
              text: chunk.text,
              hash: chunk.hash,
              model: chunk.emb ? chunk.model : null,
              emb: chunk.emb ? Buffer.from(chunk.emb) : null,
            })
            .returning({ id: t.chunks.id })
            .get()
          tx.run(
            sql`INSERT INTO chunks_fts (rowid, text) VALUES (${row.id}, ${chunk.text})`,
          )
        }
      }

      for (const b of write.backfill) {
        tx.update(t.chunks)
          .set({ model: b.model, emb: Buffer.from(b.emb) })
          .where(and(eq(t.chunks.id, b.id), eq(t.chunks.sourceId, sourceId)))
          .run()
      }

      const counts = tx
        .select({
          total: sql<number>`count(*)`,
          embedded: sql<number>`count(${t.chunks.emb})`,
        })
        .from(t.chunks)
        .where(eq(t.chunks.sourceId, sourceId))
        .get()!
      return tx
        .update(t.sources)
        .set({
          treeSha: write.treeSha,
          fileCount: write.fileCount,
          chunkCount: counts.total,
          embeddedCount: counts.embedded,
          syncedAt: stamp,
        })
        .where(eq(t.sources.id, sourceId))
        .returning()
        .get()
    })
  }

  /** Director or whoever created the source. */
  removeSource(userId: string, teamId: string, sourceId: string): void {
    const role = this.requireMember(teamId, userId)
    const source = this.db
      .select()
      .from(t.sources)
      .where(and(eq(t.sources.teamId, teamId), eq(t.sources.id, sourceId)))
      .get()
    if (!source)
      throw new AccessError('NOT_FOUND', 'No encontramos esa fuente.')
    if (role !== 'director' && source.createdBy !== userId) {
      throw new AccessError(
        'FORBIDDEN',
        'Solo quien la importó o la dirección puede quitarla.',
      )
    }
    this.db.transaction((tx) => {
      const ids = tx
        .select({ id: t.chunks.id })
        .from(t.chunks)
        .where(eq(t.chunks.sourceId, sourceId))
        .all()
      for (const { id } of ids) {
        tx.run(sql`DELETE FROM chunks_fts WHERE rowid = ${id}`)
      }
      tx.delete(t.chunks).where(eq(t.chunks.sourceId, sourceId)).run()
      tx.delete(t.sourceFiles).where(eq(t.sourceFiles.sourceId, sourceId)).run()
      tx.delete(t.sources).where(eq(t.sources.id, sourceId)).run()
    })
  }
}
