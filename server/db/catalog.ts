import { and, asc, eq } from 'drizzle-orm'
import type { QuestionGroup, ResourceKind } from '../../shared/types.ts'
import type { Db } from './connection.ts'
import * as t from './schema.ts'

/**
 * Scoped reads. Every method takes the team id first and filters on it, so a caller
 * can never read another team's rows. Nothing outside `server/db/` touches SQL.
 */
export class Catalog {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  publicTeams() {
    return this.db
      .select()
      .from(t.teams)
      .where(eq(t.teams.visibility, 'public'))
      .orderBy(asc(t.teams.name))
      .all()
  }

  publicTeamBySlug(slug: string) {
    return this.db
      .select()
      .from(t.teams)
      .where(and(eq(t.teams.slug, slug), eq(t.teams.visibility, 'public')))
      .get()
  }

  identities(teamId: string) {
    return this.db
      .select()
      .from(t.identities)
      .where(eq(t.identities.teamId, teamId))
      .orderBy(asc(t.identities.position))
      .all()
  }

  /** A team has one active defense in F1. */
  defense(teamId: string) {
    return this.db
      .select()
      .from(t.defenses)
      .where(eq(t.defenses.teamId, teamId))
      .get()
  }

  sections(teamId: string) {
    return this.db
      .select()
      .from(t.sections)
      .where(eq(t.sections.teamId, teamId))
      .orderBy(asc(t.sections.number))
      .all()
  }

  points(teamId: string) {
    return this.db
      .select()
      .from(t.points)
      .where(eq(t.points.teamId, teamId))
      .orderBy(asc(t.points.position))
      .all()
  }

  questions(
    teamId: string,
    group: QuestionGroup | null,
    limit: number,
    offset: number,
  ) {
    const base = and(
      eq(t.questions.teamId, teamId),
      eq(t.questions.status, 'approved'),
    )
    const where = group ? and(base, eq(t.questions.group, group)) : base
    return this.db
      .select()
      .from(t.questions)
      .where(where)
      .orderBy(asc(t.questions.position))
      .limit(limit)
      .offset(offset)
      .all()
  }

  /** One approved question of the team, or undefined. Used to grade an answer against its reference. */
  question(teamId: string, questionId: string) {
    return this.db
      .select()
      .from(t.questions)
      .where(
        and(
          eq(t.questions.teamId, teamId),
          eq(t.questions.id, questionId),
          eq(t.questions.status, 'approved'),
        ),
      )
      .get()
  }

  resources(teamId: string, kind: ResourceKind | null) {
    const base = eq(t.resources.teamId, teamId)
    const where = kind ? and(base, eq(t.resources.kind, kind)) : base
    return this.db
      .select()
      .from(t.resources)
      .where(where)
      .orderBy(asc(t.resources.position))
      .all()
  }
}
