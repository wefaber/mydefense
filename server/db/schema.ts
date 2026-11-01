import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import type {
  PointStatus,
  QuestionGroup,
  QuestionStatus,
  ResourceKind,
  Visibility,
} from '../../shared/types.ts'

const id = () => text('id').primaryKey()
const createdAt = () => text('created_at').notNull()

export const teams = sqliteTable(
  'teams',
  {
    id: id(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    visibility: text('visibility').$type<Visibility>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('teams_slug').on(t.slug)],
)

/** Who presents. Practice picks one; no account needed. */
export const identities = sqliteTable(
  'identities',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id),
    key: text('key').notNull(),
    name: text('name').notNull(),
    role: text('role').notNull(),
    sectors: text('sectors').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [uniqueIndex('identities_team_key').on(t.teamId, t.key)],
)

export const defenses = sqliteTable(
  'defenses',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id),
    title: text('title').notNull(),
    date: text('date').notNull(),
    criteria: text('criteria', { mode: 'json' })
      .$type<{ name: string; description: string }[]>()
      .notNull(),
  },
  (t) => [index('defenses_team').on(t.teamId)],
)

export const sections = sqliteTable(
  'sections',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id),
    defenseId: text('defense_id')
      .notNull()
      .references(() => defenses.id),
    number: integer('number').notNull(),
    title: text('title').notNull(),
  },
  (t) => [uniqueIndex('sections_defense_number').on(t.defenseId, t.number)],
)

export const points = sqliteTable(
  'points',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id),
    defenseId: text('defense_id')
      .notNull()
      .references(() => defenses.id),
    sectionId: text('section_id')
      .notNull()
      .references(() => sections.id),
    ownerId: text('owner_id').references(() => identities.id),
    /** Human code inside the defense, e.g. "3.4". */
    code: text('code').notNull(),
    title: text('title').notNull(),
    script: text('script').notNull(),
    say: text('say', { mode: 'json' }).$type<string[]>().notNull(),
    refs: text('refs', { mode: 'json' }).$type<string[]>().notNull(),
    status: text('status').$type<PointStatus>().notNull(),
    todo: text('todo').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [uniqueIndex('points_defense_code').on(t.defenseId, t.code)],
)

export const questions = sqliteTable(
  'questions',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id),
    defenseId: text('defense_id')
      .notNull()
      .references(() => defenses.id),
    pointId: text('point_id').references(() => points.id),
    group: text('group').$type<QuestionGroup>().notNull(),
    prompt: text('prompt').notNull(),
    modelAnswer: text('model_answer').notNull(),
    /** Where it comes from, shown above the prompt ("Punto 3.4", "ASO 7 (U2)"). */
    source: text('source').notNull(),
    /** Group specific extras: ASO unit / expected answer / commands, topic number. */
    extra: text('extra', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    status: text('status').$type<QuestionStatus>().notNull(),
    validatorNotes: text('validator_notes').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [index('questions_team_group').on(t.teamId, t.group)],
)

export const resources = sqliteTable(
  'resources',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id),
    defenseId: text('defense_id')
      .notNull()
      .references(() => defenses.id),
    kind: text('kind').$type<ResourceKind>().notNull(),
    title: text('title').notNull(),
    body: text('body', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    position: integer('position').notNull(),
  },
  (t) => [index('resources_team_kind').on(t.teamId, t.kind)],
)
