import {
  blob,
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
  Role,
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

/* --- F2: accounts, membership, invites, materials -------------------------------------------------------------- */

/** `@wefaber/accounts` AccountUser. No email is asked in MyDefense, so `email_enc` stays empty. */
export const users = sqliteTable(
  'users',
  {
    id: id(),
    handle: text('handle').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash'),
    emailEnc: text('email_enc'),
    totpSecretEnc: text('totp_secret_enc'),
    totpEnabled: integer('totp_enabled', { mode: 'boolean' }).notNull(),
    status: text('status').$type<'active' | 'suspended'>().notNull(),
    createdAt: createdAt(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('users_handle').on(t.handle)],
)

/** Only the sha256 of the token is stored. */
export const sessions = sqliteTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    expiresAt: text('expires_at').notNull(),
    lastSeen: text('last_seen').notNull(),
  },
  (t) => [index('sessions_user').on(t.userId)],
)

export const recoveryCodes = sqliteTable(
  'recovery_codes',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: text('used_at'),
  },
  (t) => [uniqueIndex('recovery_codes_user_hash').on(t.userId, t.codeHash)],
)

/**
 * A GitHub sign-in linked to a user. Only the numeric GitHub id and the org check are kept: never the OAuth token,
 * never the email. `checked_at` drives the 24 h re-verification before a team can be created.
 */
export const githubLinks = sqliteTable(
  'github_links',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    githubId: text('github_id').notNull(),
    org: text('org').notNull(),
    member: integer('member', { mode: 'boolean' }).notNull(),
    checkedAt: text('checked_at').notNull(),
  },
  (t) => [uniqueIndex('github_links_github_id').on(t.githubId)],
)

export const members = sqliteTable(
  'members',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<Role>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('members_team_user').on(t.teamId, t.userId),
    index('members_user').on(t.userId),
  ],
)

export const invites = sqliteTable(
  'invites',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id),
    tokenHash: text('token_hash').notNull(),
    role: text('role').$type<Role>().notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    expiresAt: text('expires_at').notNull(),
    usedAt: text('used_at'),
  },
  (t) => [
    uniqueIndex('invites_token').on(t.tokenHash),
    index('invites_team').on(t.teamId),
  ],
)

/** An uploaded source file. `extracted_text` is filled by the F4 pipeline. */
export const materials = sqliteTable(
  'materials',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id),
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    /** Path relative to the files directory. */
    storagePath: text('storage_path').notNull(),
    extractedText: text('extracted_text'),
    uploadedBy: text('uploaded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [index('materials_team').on(t.teamId)],
)

/* --- Knowledge: indexed sources (a GitHub repo folder) ------------------------------------------------------------ */

/** A body of text a team indexes. `tree_sha` is the version of what was indexed: same sha, nothing to fetch. */
export const sources = sqliteTable(
  'sources',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id),
    kind: text('kind').$type<'github'>().notNull(),
    /** Repo name inside the configured org. */
    repo: text('repo').notNull(),
    /** Folder inside the repo ('' = all of it). */
    folder: text('folder').notNull(),
    /** Branch, tag or commit ('HEAD' = default branch). */
    ref: text('ref').notNull(),
    treeSha: text('tree_sha').notNull(),
    fileCount: integer('file_count').notNull(),
    chunkCount: integer('chunk_count').notNull(),
    /** Chunks that carry an embedding. Fewer than `chunk_count` when the embedder was off or down. */
    embeddedCount: integer('embedded_count').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    syncedAt: text('synced_at').notNull(),
  },
  (t) => [
    index('sources_team').on(t.teamId),
    uniqueIndex('sources_spec').on(t.teamId, t.repo, t.folder, t.ref),
  ],
)

/** One indexed file of a source; `blob_sha` tells a re-sync which files changed. */
export const sourceFiles = sqliteTable(
  'source_files',
  {
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    blobSha: text('blob_sha').notNull(),
    chunks: integer('chunks').notNull(),
  },
  (t) => [uniqueIndex('source_files_path').on(t.sourceId, t.path)],
)

/** A piece of a file. `emb` is a little-endian float32 vector, null until the embedder has seen it. */
export const chunks = sqliteTable(
  'chunks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    idx: integer('idx').notNull(),
    text: text('text').notNull(),
    /** sha1 of the text: an unchanged chunk keeps its embedding. */
    hash: text('hash').notNull(),
    model: text('model'),
    emb: blob('emb', { mode: 'buffer' }),
  },
  (t) => [
    index('chunks_source').on(t.sourceId),
    index('chunks_team_hash').on(t.teamId, t.hash),
  ],
)

/* --- Authoring: a generated draft of the defense, kept apart until a director approves it ------------------------- */

export type DraftStatus =
  | 'running'
  | 'ready'
  | 'failed'
  | 'approved'
  | 'discarded'

/**
 * One generation. The draft (sections, points, questions) lives here as JSON and reaches the public tables only when
 * a director approves it, so unreviewed model output is never shown to people practicing.
 */
export const generationRuns = sqliteTable(
  'generation_runs',
  {
    id: id(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id),
    status: text('status').$type<DraftStatus>().notNull(),
    /** 'outline' | 'points' while running. */
    phase: text('phase').notNull(),
    total: integer('total').notNull(),
    done: integer('done').notNull(),
    error: text('error').notNull(),
    draft: text('draft', { mode: 'json' }).$type<unknown>(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    finishedAt: text('finished_at'),
  },
  (t) => [index('generation_runs_team').on(t.teamId)],
)
