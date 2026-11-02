import { and, desc, eq, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import type { Draft } from '../ai/author.ts'
import type { Db } from './connection.ts'
import * as t from './schema.ts'
import { AccessError } from './workspace.ts'

export type GenerationRun = typeof t.generationRuns.$inferSelect

export interface Approval {
  /** Point codes ("2.1") and question ids ("2.1#0", the position inside the point) the director left out. */
  skip: ReadonlySet<string>
  /** Point code -> identity key chosen in the review; a missing code keeps the model's suggestion. */
  owners: Readonly<Record<string, string | null>>
}

/**
 * The draft a generation produced and what happens to it. The draft stays in `generation_runs` until a director
 * approves it; only then do sections, points and approved questions exist in the tables people practice from.
 */
export class Authoring {
  private readonly db: Db
  private readonly now: () => Date

  constructor(db: Db, now: () => Date = () => new Date()) {
    this.db = db
    this.now = now
  }

  private requireDirector(teamId: string, userId: string): void {
    const role = this.db
      .select({ role: t.members.role })
      .from(t.members)
      .where(and(eq(t.members.teamId, teamId), eq(t.members.userId, userId)))
      .get()?.role
    if (!role) throw new AccessError('NOT_FOUND', 'No encontramos ese equipo.')
    if (role !== 'director') {
      throw new AccessError(
        'FORBIDDEN',
        'Solo la dirección del equipo puede hacer esto.',
      )
    }
  }

  private hasPoints(teamId: string): boolean {
    return (
      this.db
        .select({ n: sql<number>`count(*)` })
        .from(t.points)
        .where(eq(t.points.teamId, teamId))
        .get()!.n > 0
    )
  }

  /** The latest generation of the team, whatever its state. Directors only: a draft is not public. */
  latest(userId: string, teamId: string): GenerationRun | undefined {
    this.requireDirector(teamId, userId)
    return this.db
      .select()
      .from(t.generationRuns)
      .where(eq(t.generationRuns.teamId, teamId))
      .orderBy(desc(t.generationRuns.createdAt))
      .limit(1)
      .get()
  }

  /** Opens a run. One at a time per team, and only for a team that has no points yet. */
  start(userId: string, teamId: string): GenerationRun {
    this.requireDirector(teamId, userId)
    if (this.latest(userId, teamId)?.status === 'running') {
      throw new AccessError('CONFLICT', 'Ya hay una generación en curso.')
    }
    if (this.hasPoints(teamId)) {
      throw new AccessError(
        'CONFLICT',
        'Este equipo ya tiene puntos: la generación arma la defensa de un equipo nuevo.',
      )
    }
    return this.db
      .insert(t.generationRuns)
      .values({
        id: ulid(),
        teamId,
        status: 'running',
        phase: 'outline',
        total: 0,
        done: 0,
        error: '',
        draft: null,
        createdBy: userId,
        createdAt: this.now().toISOString(),
        finishedAt: null,
      })
      .returning()
      .get()
  }

  progress(
    runId: string,
    patch: { phase: string; total: number; done: number },
  ) {
    this.db
      .update(t.generationRuns)
      .set(patch)
      .where(
        and(
          eq(t.generationRuns.id, runId),
          eq(t.generationRuns.status, 'running'),
        ),
      )
      .run()
  }

  finish(runId: string, draft: Draft): void {
    this.db
      .update(t.generationRuns)
      .set({ status: 'ready', draft, finishedAt: this.now().toISOString() })
      .where(eq(t.generationRuns.id, runId))
      .run()
  }

  fail(runId: string, message: string): void {
    this.db
      .update(t.generationRuns)
      .set({
        status: 'failed',
        error: message.slice(0, 300),
        finishedAt: this.now().toISOString(),
      })
      .where(eq(t.generationRuns.id, runId))
      .run()
  }

  /** A server restart kills any job in flight: its run can never finish, so it is marked failed at boot. */
  failStale(): number {
    return this.db
      .update(t.generationRuns)
      .set({
        status: 'failed',
        error: 'El servidor se reinició durante la generación.',
        finishedAt: this.now().toISOString(),
      })
      .where(eq(t.generationRuns.status, 'running'))
      .returning({ id: t.generationRuns.id })
      .all().length
  }

  discard(userId: string, teamId: string, runId: string): void {
    this.requireDirector(teamId, userId)
    const run = this.run(teamId, runId)
    if (run.status === 'running' || run.status === 'approved') {
      throw new AccessError(
        'CONFLICT',
        'Esa generación ya no se puede descartar.',
      )
    }
    this.db
      .update(t.generationRuns)
      .set({ status: 'discarded', draft: null })
      .where(eq(t.generationRuns.id, runId))
      .run()
  }

  private run(teamId: string, runId: string): GenerationRun {
    const run = this.db
      .select()
      .from(t.generationRuns)
      .where(
        and(
          eq(t.generationRuns.teamId, teamId),
          eq(t.generationRuns.id, runId),
        ),
      )
      .get()
    if (!run)
      throw new AccessError('NOT_FOUND', 'No encontramos esa generación.')
    return run
  }

  /** Writes the reviewed draft into the real tables, as approved. All or nothing. */
  approve(
    userId: string,
    teamId: string,
    runId: string,
    approval: Approval,
  ): { points: number; questions: number } {
    this.requireDirector(teamId, userId)
    const run = this.run(teamId, runId)
    const draft = run.draft as Draft | null
    if (run.status !== 'ready' || !draft) {
      throw new AccessError('CONFLICT', 'Ese borrador ya no se puede aprobar.')
    }
    if (this.hasPoints(teamId)) {
      throw new AccessError('CONFLICT', 'Este equipo ya tiene puntos.')
    }
    const defense = this.db
      .select()
      .from(t.defenses)
      .where(eq(t.defenses.teamId, teamId))
      .get()
    if (!defense)
      throw new AccessError('NOT_FOUND', 'El equipo no tiene defensa.')
    const identities = new Map(
      this.db
        .select({ id: t.identities.id, key: t.identities.key })
        .from(t.identities)
        .where(eq(t.identities.teamId, teamId))
        .all()
        .map((i) => [i.key, i.id]),
    )

    let points = 0
    let questions = 0
    this.db.transaction((tx) => {
      let position = 0
      let q = 0
      for (const section of draft.sections) {
        const kept = section.points.filter((p) => !approval.skip.has(p.code))
        if (kept.length === 0) continue
        const sectionId = ulid()
        tx.insert(t.sections)
          .values({
            id: sectionId,
            teamId,
            defenseId: defense.id,
            number: section.number,
            title: section.title,
          })
          .run()
        for (const p of kept) {
          const pointId = ulid()
          const owner = Object.hasOwn(approval.owners, p.code)
            ? approval.owners[p.code]
            : p.owner
          tx.insert(t.points)
            .values({
              id: pointId,
              teamId,
              defenseId: defense.id,
              sectionId,
              ownerId: (owner && identities.get(owner)) || null,
              code: p.code,
              title: p.title,
              script: p.script,
              say: p.say,
              refs: p.refs,
              status: p.status,
              todo: p.todo,
              position: position++,
            })
            .run()
          points++
          p.questions.forEach((question, i) => {
            if (approval.skip.has(`${p.code}#${i}`)) return
            tx.insert(t.questions)
              .values({
                id: ulid(),
                teamId,
                defenseId: defense.id,
                pointId,
                group: 'point',
                prompt: question.prompt,
                modelAnswer: question.modelAnswer,
                source: `Punto ${p.code}`,
                extra: { path: question.path, evidence: question.evidence },
                status: 'approved',
                validatorNotes: `Cita de ${question.path}: «${question.evidence}»`,
                position: q++,
              })
              .run()
            questions++
          })
        }
      }
      tx.update(t.generationRuns)
        .set({ status: 'approved', finishedAt: this.now().toISOString() })
        .where(eq(t.generationRuns.id, runId))
        .run()
    })
    return { points, questions }
  }
}
