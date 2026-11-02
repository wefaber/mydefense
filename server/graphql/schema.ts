import SchemaBuilder from '@pothos/core'
import { clientKey, sessionCookie, type AccountUser } from '@wefaber/accounts'
import { GraphQLError } from 'graphql'
import { gatherEvidence } from '../ai/evidence.ts'
import {
  GradingError,
  gradeAnswer,
  type Delivery,
  type Grading,
  type SourceRef,
} from '../ai/grading.ts'
import { LlmError } from '../ai/llm.ts'
import { proposeRoles } from '../ai/roles.ts'
import { startGeneration } from '../authoring.ts'
import type { GenerationRun } from '../db/authoring.ts'
import { rolePassages, searchKnowledge, type Hit } from '../knowledge.ts'
import {
  readDispute,
  readRecap,
  readRecapAnswers,
  recapSession,
  type Recap,
} from '../ai/recap.ts'
import { VoiceError, mintToken, type VoiceToken } from '../ai/voice.ts'
import {
  GRADES,
  POINT_STATUSES,
  QUESTION_GROUPS,
  RESOURCE_KINDS,
  ROLES,
  VISIBILITIES,
  clampPage,
  type Grade,
  type PointStatus,
  type QuestionGroup,
  type ResourceKind,
  type Role,
  type Visibility,
} from '../../shared/types.ts'
import { AccessError } from '../db/workspace.ts'
import type * as t from '../db/schema.ts'
import { teamAccess } from '../github.ts'
import { SESSION_COOKIE } from '../session.ts'
import type { Services } from '../services.ts'

export interface Context extends Services {
  request: Request
  viewer: AccountUser | null
  secureCookie: boolean
}

type Team = typeof t.teams.$inferSelect
type Identity = typeof t.identities.$inferSelect
type Defense = typeof t.defenses.$inferSelect
type Section = typeof t.sections.$inferSelect
type Point = typeof t.points.$inferSelect
type Question = typeof t.questions.$inferSelect
type Resource = typeof t.resources.$inferSelect

const fail = (code: string, message: string) =>
  new GraphQLError(message, { extensions: { code } })

/** Domain failures become GraphQL errors with a stable code; anything else stays masked by Yoga. */
function guard<T>(fn: () => T): T {
  try {
    return fn()
  } catch (e) {
    if (e instanceof AccessError) throw fail(e.code, e.message)
    throw e
  }
}
async function guardAsync<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof AccessError) throw fail(e.code, e.message)
    throw e
  }
}

function need(ctx: Context): AccountUser {
  if (!ctx.viewer) throw fail('UNAUTHENTICATED', 'Ingresá para continuar.')
  return ctx.viewer
}

/** The review sends point code -> identity key; anything else in the map is ignored. */
function ownersOf(raw: unknown): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [code, key] of Object.entries(raw)) {
      if (typeof key === 'string' || key === null) out[code] = key
    }
  }
  return out
}

/** Creating a team is for members of the configured GitHub org, re-checked at each GitHub sign-in (ADR 0004). */
async function creatorAccess(ctx: Context, userId: string): Promise<void> {
  if (!ctx.github) {
    throw fail(
      'UNAVAILABLE',
      'La creación de equipos no está disponible en este servidor.',
    )
  }
  const link = await ctx.githubLinks.findByUser(userId)
  switch (teamAccess(link, ctx.github.org, new Date())) {
    case 'ok':
      return
    case 'reverify':
      throw fail(
        'REVERIFY',
        'Volvé a entrar con GitHub para confirmar que seguís en la organización.',
      )
    case 'no-link':
      throw fail(
        'FORBIDDEN',
        'Para crear un equipo entrá con GitHub desde la página de cuenta.',
      )
    case 'not-member':
      throw fail(
        'FORBIDDEN',
        `Crear equipos es para miembros de la organización ${ctx.github.org} en GitHub.`,
      )
  }
}

/** Joining a team by invite needs a GitHub sign-in, so an invite link alone is not enough (ADR 0006). */
async function joinerAccess(ctx: Context, userId: string): Promise<void> {
  if (!ctx.github) {
    throw fail(
      'UNAVAILABLE',
      'Unirse a equipos no está disponible en este servidor.',
    )
  }
  const link = await ctx.githubLinks.findByUser(userId)
  if (!link) {
    throw fail(
      'FORBIDDEN',
      'Para entrar a un equipo entrá con GitHub desde la página de cuenta.',
    )
  }
}

function rateLimit(
  ctx: Context,
  key: string,
  max: number,
  windowMs: number,
): void {
  const res = ctx.limiter.take(key, { max, windowMs })
  if (!res.ok) {
    throw fail(
      'RATE_LIMITED',
      `Demasiados intentos. Probá de nuevo en ${res.retryAfter} s.`,
    )
  }
}

async function setSession(
  ctx: Context,
  token: string,
  expiresAt: Date,
): Promise<void> {
  const opts = sessionCookie(expiresAt, { path: '/', secure: ctx.secureCookie })
  await ctx.request.cookieStore?.set({
    name: SESSION_COOKIE,
    value: token,
    domain: null,
    expires: opts.expires ?? null,
    path: opts.path,
    secure: opts.secure,
    sameSite: opts.sameSite,
    httpOnly: opts.httpOnly,
  })
}

export function buildSchema() {
  const builder = new SchemaBuilder<{
    Context: Context
    Scalars: { JSON: { Input: unknown; Output: unknown } }
  }>({})

  builder.scalarType('JSON', {
    serialize: (value) => value,
    parseValue: (value) => value,
  })

  const PointStatusEnum = builder.enumType('PointStatus', {
    values: POINT_STATUSES as readonly PointStatus[],
  })
  const QuestionGroupEnum = builder.enumType('QuestionGroup', {
    values: QUESTION_GROUPS as readonly QuestionGroup[],
  })
  const ResourceKindEnum = builder.enumType('ResourceKind', {
    values: RESOURCE_KINDS as readonly ResourceKind[],
  })
  const RoleEnum = builder.enumType('Role', {
    values: ROLES as readonly Role[],
  })
  const VisibilityEnum = builder.enumType('Visibility', {
    values: VISIBILITIES as readonly Visibility[],
  })

  const Criterion = builder.objectRef<{ name: string; description: string }>(
    'Criterion',
  )
  Criterion.implement({
    fields: (f) => ({
      name: f.exposeString('name'),
      description: f.exposeString('description'),
    }),
  })

  const IdentityRef = builder.objectRef<Identity>('Identity')
  IdentityRef.implement({
    fields: (f) => ({
      id: f.exposeID('id'),
      key: f.exposeString('key'),
      name: f.exposeString('name'),
      role: f.exposeString('role'),
      sectors: f.exposeString('sectors'),
    }),
  })

  const SectionRef = builder.objectRef<Section>('Section')
  SectionRef.implement({
    fields: (f) => ({
      id: f.exposeID('id'),
      number: f.exposeInt('number'),
      title: f.exposeString('title'),
    }),
  })

  const PointRef = builder.objectRef<Point>('Point')
  PointRef.implement({
    fields: (f) => ({
      id: f.exposeID('id'),
      code: f.exposeString('code'),
      title: f.exposeString('title'),
      script: f.exposeString('script'),
      say: f.exposeStringList('say'),
      refs: f.exposeStringList('refs'),
      status: f.field({ type: PointStatusEnum, resolve: (p) => p.status }),
      todo: f.exposeString('todo'),
      ownerId: f.exposeID('ownerId', { nullable: true }),
      sectionId: f.exposeID('sectionId'),
    }),
  })

  const QuestionRef = builder.objectRef<Question>('Question')
  QuestionRef.implement({
    fields: (f) => ({
      id: f.exposeID('id'),
      pointId: f.exposeID('pointId', { nullable: true }),
      group: f.field({ type: QuestionGroupEnum, resolve: (q) => q.group }),
      prompt: f.exposeString('prompt'),
      modelAnswer: f.exposeString('modelAnswer'),
      source: f.exposeString('source'),
      extra: f.field({ type: 'JSON', resolve: (q) => q.extra }),
    }),
  })

  const ResourceRef = builder.objectRef<Resource>('Resource')
  ResourceRef.implement({
    fields: (f) => ({
      id: f.exposeID('id'),
      kind: f.field({ type: ResourceKindEnum, resolve: (r) => r.kind }),
      title: f.exposeString('title'),
      body: f.field({ type: 'JSON', resolve: (r) => r.body }),
    }),
  })

  const DefenseRef = builder.objectRef<Defense>('Defense')
  DefenseRef.implement({
    fields: (f) => ({
      id: f.exposeID('id'),
      title: f.exposeString('title'),
      date: f.exposeString('date'),
      criteria: f.field({ type: [Criterion], resolve: (d) => d.criteria }),
      sections: f.field({
        type: [SectionRef],
        resolve: (d, _args, ctx) => ctx.catalog.sections(d.teamId),
      }),
      points: f.field({
        type: [PointRef],
        resolve: (d, _args, ctx) => ctx.catalog.points(d.teamId),
      }),
      questions: f.field({
        type: [QuestionRef],
        args: {
          group: f.arg({ type: QuestionGroupEnum }),
          first: f.arg.int(),
          offset: f.arg.int(),
        },
        resolve: (d, args, ctx) =>
          ctx.catalog.questions(
            d.teamId,
            args.group ?? null,
            clampPage(args.first),
            Math.max(0, args.offset ?? 0),
          ),
      }),
      resources: f.field({
        type: [ResourceRef],
        args: { kind: f.arg({ type: ResourceKindEnum }) },
        resolve: (d, args, ctx) =>
          ctx.catalog.resources(d.teamId, args.kind ?? null),
      }),
    }),
  })

  /* --- Accounts and team management ---------------------------------------------------------------------- */

  const UserRef = builder.objectRef<AccountUser>('User')
  UserRef.implement({
    fields: (f) => ({
      id: f.exposeID('id'),
      handle: f.exposeString('handle'),
      displayName: f.exposeString('displayName'),
    }),
  })

  const MemberRef = builder.objectRef<{
    id: string
    userId: string
    role: Role
    handle: string
    displayName: string
  }>('Member')
  MemberRef.implement({
    fields: (f) => ({
      id: f.exposeID('id'),
      userId: f.exposeID('userId'),
      role: f.field({ type: RoleEnum, resolve: (m) => m.role }),
      handle: f.exposeString('handle'),
      displayName: f.exposeString('displayName'),
    }),
  })

  const InviteRef = builder.objectRef<{
    id: string
    role: Role
    expiresAt: string
  }>('Invite')
  InviteRef.implement({
    fields: (f) => ({
      id: f.exposeID('id'),
      role: f.field({ type: RoleEnum, resolve: (i) => i.role }),
      expiresAt: f.exposeString('expiresAt'),
    }),
  })

  const MaterialRef = builder.objectRef<{
    id: string
    name: string
    mime: string
    size: number
    createdAt: string
  }>('Material')
  MaterialRef.implement({
    fields: (f) => ({
      id: f.exposeID('id'),
      name: f.exposeString('name'),
      mime: f.exposeString('mime'),
      size: f.exposeInt('size'),
      createdAt: f.exposeString('createdAt'),
    }),
  })

  const IndexedSourceRef = builder.objectRef<{
    id: string
    repo: string
    folder: string
    ref: string
    fileCount: number
    chunkCount: number
    embeddedCount: number
    syncedAt: string
  }>('IndexedSource')
  IndexedSourceRef.implement({
    fields: (f) => ({
      id: f.exposeID('id'),
      repo: f.exposeString('repo'),
      folder: f.exposeString('folder'),
      ref: f.exposeString('ref'),
      fileCount: f.exposeInt('fileCount'),
      chunkCount: f.exposeInt('chunkCount'),
      /** Chunks that also have an embedding: fewer than chunkCount while the embedder was off or down. */
      embeddedCount: f.exposeInt('embeddedCount'),
      syncedAt: f.exposeString('syncedAt'),
    }),
  })

  const RoleCandidateRef = builder.objectRef<{
    name: string
    role: string
    sectors: string
    evidence: string
    path: string
  }>('RoleCandidate')
  RoleCandidateRef.implement({
    fields: (f) => ({
      name: f.exposeString('name'),
      role: f.exposeString('role'),
      sectors: f.exposeString('sectors'),
      /** A literal quote of the source that backs this person. */
      evidence: f.exposeString('evidence'),
      path: f.exposeString('path'),
    }),
  })

  const GenerationRef = builder.objectRef<GenerationRun>('Generation')
  GenerationRef.implement({
    fields: (f) => ({
      id: f.exposeID('id'),
      /** running | ready | failed | approved | discarded */
      status: f.exposeString('status'),
      /** outline | points while running. */
      phase: f.exposeString('phase'),
      total: f.exposeInt('total'),
      done: f.exposeInt('done'),
      error: f.exposeString('error'),
      /** The draft to review: sections, points and questions. Only while status is ready. */
      draft: f.field({
        type: 'JSON',
        nullable: true,
        resolve: (g) => (g.status === 'ready' ? g.draft : null),
      }),
      createdAt: f.exposeString('createdAt'),
    }),
  })

  const ApprovalRef = builder.objectRef<{ points: number; questions: number }>(
    'Approval',
  )
  ApprovalRef.implement({
    fields: (f) => ({
      points: f.exposeInt('points'),
      questions: f.exposeInt('questions'),
    }),
  })

  const PassageRef = builder.objectRef<Hit>('Passage')
  PassageRef.implement({
    fields: (f) => ({
      id: f.id({ resolve: (h) => String(h.id) }),
      path: f.exposeString('path'),
      text: f.exposeString('text'),
      score: f.exposeFloat('score'),
      via: f.exposeString('via'),
    }),
  })

  const SearchResultRef = builder.objectRef<{
    semantic: boolean
    hits: Hit[]
  }>('SearchResult')
  SearchResultRef.implement({
    fields: (f) => ({
      semantic: f.exposeBoolean('semantic'),
      hits: f.field({ type: [PassageRef], resolve: (r) => r.hits }),
    }),
  })

  const TeamRef = builder.objectRef<Team>('Team')
  TeamRef.implement({
    fields: (f) => ({
      id: f.exposeID('id'),
      slug: f.exposeString('slug'),
      name: f.exposeString('name'),
      visibility: f.field({
        type: VisibilityEnum,
        resolve: (team) => team.visibility,
      }),
      myRole: f.field({
        type: RoleEnum,
        nullable: true,
        resolve: (team, _args, ctx) =>
          ctx.viewer ? ctx.workspace.roleOf(team.id, ctx.viewer.id) : null,
      }),
      identities: f.field({
        type: [IdentityRef],
        resolve: (team, _args, ctx) => ctx.catalog.identities(team.id),
      }),
      defense: f.field({
        type: DefenseRef,
        nullable: true,
        resolve: (team, _args, ctx) => ctx.catalog.defense(team.id) ?? null,
      }),
      members: f.field({
        type: [MemberRef],
        resolve: (team, _args, ctx) =>
          guard(() => ctx.workspace.members(need(ctx).id, team.id)),
      }),
      invites: f.field({
        type: [InviteRef],
        resolve: (team, _args, ctx) =>
          guard(() => ctx.workspace.invites(need(ctx).id, team.id)),
      }),
      /** The latest generated draft of the defense. Directors only; null for everyone else. */
      generation: f.field({
        type: GenerationRef,
        nullable: true,
        resolve: (team, _args, ctx) =>
          ctx.viewer &&
          ctx.workspace.roleOf(team.id, ctx.viewer.id) === 'director'
            ? (ctx.authoring.latest(ctx.viewer.id, team.id) ?? null)
            : null,
      }),
      materials: f.field({
        type: [MaterialRef],
        resolve: (team, _args, ctx) =>
          guard(() => ctx.workspace.materials(need(ctx).id, team.id)),
      }),
      sources: f.field({
        type: [IndexedSourceRef],
        resolve: (team, _args, ctx) =>
          guard(() => ctx.knowledge.sources(need(ctx).id, team.id)),
      }),
    }),
  })

  const RegisterPayload = builder.objectRef<{
    user: AccountUser
    recoveryCodes: string[]
  }>('RegisterPayload')
  RegisterPayload.implement({
    fields: (f) => ({
      user: f.field({ type: UserRef, resolve: (p) => p.user }),
      recoveryCodes: f.exposeStringList('recoveryCodes'),
    }),
  })

  const InviteToken = builder.objectRef<{ token: string; expiresAt: string }>(
    'InviteToken',
  )
  InviteToken.implement({
    fields: (f) => ({
      token: f.exposeString('token'),
      expiresAt: f.exposeString('expiresAt'),
    }),
  })

  /* --- Answering: grading and voice ----------------------------------------------------------------------- */

  const GradeEnum = builder.enumType('Grade', {
    values: GRADES as readonly Grade[],
  })
  const CriteriaScores =
    builder.objectRef<Grading['criteria']>('CriteriaScores')
  CriteriaScores.implement({
    fields: (f) => ({
      content: f.exposeInt('content'),
      terminology: f.exposeInt('terminology'),
      structure: f.exposeInt('structure'),
    }),
  })
  const FillerCount = builder.objectRef<{ word: string; count: number }>(
    'FillerCount',
  )
  FillerCount.implement({
    fields: (f) => ({
      word: f.exposeString('word'),
      count: f.exposeInt('count'),
    }),
  })
  const DeliveryRef = builder.objectRef<Delivery>('Delivery')
  DeliveryRef.implement({
    fields: (f) => ({
      words: f.exposeInt('words'),
      wpm: f.exposeInt('wpm', { nullable: true }),
      fillers: f.field({ type: [FillerCount], resolve: (d) => d.fillers }),
    }),
  })
  const SourceRefType = builder.objectRef<SourceRef>('Source')
  SourceRefType.implement({
    fields: (f) => ({
      n: f.exposeInt('n'),
      title: f.exposeString('title'),
      path: f.exposeString('path'),
      url: f.exposeString('url', { nullable: true }),
      kind: f.exposeString('kind'),
      code: f.exposeString('code', { nullable: true }),
      created: f.exposeString('created', { nullable: true }),
      closed: f.exposeString('closed', { nullable: true }),
      snippet: f.exposeString('snippet'),
    }),
  })
  const GradingRef = builder.objectRef<Grading>('Grading')
  GradingRef.implement({
    fields: (f) => ({
      answer: f.exposeString('answer'),
      note: f.exposeString('note'),
      verdict: f.field({ type: GradeEnum, resolve: (g) => g.verdict }),
      criteria: f.field({ type: CriteriaScores, resolve: (g) => g.criteria }),
      covered: f.exposeStringList('covered'),
      missing: f.exposeStringList('missing'),
      unsupported: f.exposeStringList('unsupported'),
      feedback: f.exposeString('feedback'),
      confidence: f.exposeString('confidence'),
      referenceIssue: f.exposeString('referenceIssue'),
      argument: f.exposeString('argument'),
      sources: f.field({ type: [SourceRefType], resolve: (g) => g.sources }),
      consulted: f.exposeInt('consulted'),
      delivery: f.field({
        type: DeliveryRef,
        nullable: true,
        resolve: (g) => g.delivery,
      }),
    }),
  })
  const RecapRef = builder.objectRef<Recap>('Recap')
  RecapRef.implement({
    fields: (f) => ({
      analysis: f.exposeString('analysis'),
      strengths: f.exposeStringList('strengths'),
      gaps: f.exposeStringList('gaps'),
      conclusion: f.exposeString('conclusion'),
    }),
  })
  const VoiceTokenRef = builder.objectRef<VoiceToken>('VoiceToken')
  VoiceTokenRef.implement({
    fields: (f) => ({
      token: f.exposeString('token'),
      expiresIn: f.exposeInt('expiresIn'),
      version: f.exposeString('version'),
    }),
  })
  const CapabilitiesRef = builder.objectRef<{
    grading: boolean
    voice: boolean
    githubOrg: string | null
    repoImport: boolean
  }>('Capabilities')
  CapabilitiesRef.implement({
    fields: (f) => ({
      grading: f.exposeBoolean('grading'),
      voice: f.exposeBoolean('voice'),
      /** Set when GitHub login is on: the org whose members may create teams. */
      githubOrg: f.exposeString('githubOrg', { nullable: true }),
      /** True when org repos can be imported as team material. */
      repoImport: f.exposeBoolean('repoImport'),
    }),
  })

  /* --- Queries -------------------------------------------------------------------------------------------- */

  builder.queryType({
    fields: (f) => ({
      capabilities: f.field({
        type: CapabilitiesRef,
        resolve: (_root, _args, ctx) => ({
          grading: !!ctx.ai.llm,
          voice: !!ctx.ai.llm && !!ctx.ai.voice,
          githubOrg: ctx.github?.org ?? null,
          repoImport: !!ctx.repoImport,
        }),
      }),
      /** Search over what the team indexed from repos: words (FTS5) plus meaning when the embedder answers. */
      searchSources: f.field({
        type: SearchResultRef,
        args: {
          teamId: f.arg.id({ required: true }),
          query: f.arg.string({ required: true }),
        },
        resolve: (_root, args, ctx) =>
          guardAsync(async () => {
            const user = need(ctx)
            rateLimit(ctx, `search:${user.id}`, 60, 60_000)
            return searchKnowledge(
              { knowledge: ctx.knowledge, embedder: ctx.ai.embedder ?? null },
              user.id,
              String(args.teamId),
              args.query,
            )
          }),
      }),
      me: f.field({
        type: UserRef,
        nullable: true,
        resolve: (_root, _args, ctx) => ctx.viewer,
      }),
      myTeams: f.field({
        type: [TeamRef],
        resolve: (_root, _args, ctx) =>
          ctx.viewer
            ? ctx.workspace.myTeams(ctx.viewer.id).map((m) => m.team)
            : [],
      }),
      teams: f.field({
        type: [TeamRef],
        resolve: (_root, _args, ctx) => ctx.catalog.publicTeams(),
      }),
      team: f.field({
        type: TeamRef,
        args: { slug: f.arg.string({ required: true }) },
        resolve: (_root, args, ctx) => {
          const team = ctx.workspace.visibleTeamBySlug(
            args.slug,
            ctx.viewer?.id ?? null,
          )
          if (!team) throw fail('NOT_FOUND', 'No encontramos ese equipo.')
          return team
        },
      }),
    }),
  })

  /* --- Mutations ------------------------------------------------------------------------------------------ */

  builder.mutationType({
    fields: (f) => ({
      register: f.field({
        type: RegisterPayload,
        args: {
          handle: f.arg.string({ required: true }),
          displayName: f.arg.string({ required: true }),
          password: f.arg.string({ required: true }),
        },
        resolve: async (_root, args, ctx) => {
          rateLimit(
            ctx,
            `register:${clientKey(ctx.request, null)}`,
            10,
            3_600_000,
          )
          const res = await ctx.accounts.register({
            handle: args.handle,
            displayName: args.displayName,
            password: args.password,
          })
          if (!res.ok) throw fail('INVALID', res.error)
          const session = await ctx.accounts.startSession(res.value.user.id)
          await setSession(ctx, session.token, session.expiresAt)
          return res.value
        },
      }),
      login: f.field({
        type: UserRef,
        args: {
          handle: f.arg.string({ required: true }),
          password: f.arg.string({ required: true }),
        },
        resolve: async (_root, args, ctx) => {
          rateLimit(ctx, `login:ip:${clientKey(ctx.request, null)}`, 30, 60_000)
          rateLimit(
            ctx,
            `login:handle:${args.handle.trim().toLowerCase()}`,
            10,
            900_000,
          )
          const out = await ctx.accounts.login(args.handle, args.password)
          if (out.kind === 'ok') {
            await setSession(ctx, out.session.token, out.session.expiresAt)
            return out.user
          }
          if (out.kind === 'suspended')
            throw fail('FORBIDDEN', 'Esta cuenta está suspendida.')
          throw fail('INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos.')
        },
      }),
      gradeAnswer: f.field({
        type: GradingRef,
        args: {
          teamSlug: f.arg.string({ required: true }),
          questionId: f.arg.id({ required: true }),
          answer: f.arg.string({ required: true }),
          /** Set when the answer was spoken; the transcript is then also measured for pace and fillers. */
          spokenMs: f.arg.int(),
          /** The student's justification of an earlier correction: asks for a review. */
          note: f.arg.string(),
        },
        resolve: async (_root, args, ctx) => {
          if (!ctx.ai.llm)
            throw fail('UNAVAILABLE', 'La corrección no está disponible.')
          const ip = clientKey(ctx.request, null)
          rateLimit(ctx, `grade:ip:${ip}`, 30, 600_000)
          rateLimit(ctx, 'grade:all', 2000, 86_400_000)
          const team = ctx.workspace.visibleTeamBySlug(
            args.teamSlug,
            ctx.viewer?.id ?? null,
          )
          const q =
            team && ctx.catalog.question(team.id, String(args.questionId))
          if (!q) throw fail('NOT_FOUND', 'No encontramos esa pregunta.')
          const expected =
            typeof q.extra.expected === 'string' ? q.extra.expected : ''
          try {
            const sources = await gatherEvidence(
              ctx.ai.evidence,
              team.slug,
              q,
              args.answer,
            )
            return await gradeAnswer(
              ctx.ai.llm,
              {
                prompt: q.prompt,
                modelAnswer: q.modelAnswer,
                expected,
                sources,
                today: new Date().toISOString().slice(0, 10),
                note: args.note ?? '',
              },
              args.answer,
              args.spokenMs == null ? null : Math.max(0, args.spokenMs),
            )
          } catch (e) {
            if (e instanceof LlmError || e instanceof GradingError)
              throw fail('UNAVAILABLE', e.message)
            throw e
          }
        },
      }),
      recapSession: f.field({
        type: RecapRef,
        nullable: true,
        args: {
          teamSlug: f.arg.string({ required: true }),
          /** The session's answers as the client holds them: verdicts and criteria, never the student's wording. */
          answers: f.arg({ type: 'JSON', required: true }),
          /** A dispute: the reading the student is answering, and what they say is wrong with it. Both or neither. */
          previous: f.arg({ type: 'JSON' }),
          dispute: f.arg.string(),
        },
        resolve: async (_root, args, ctx) => {
          if (!ctx.ai.llm)
            throw fail('UNAVAILABLE', 'La corrección no está disponible.')
          // Shares the grading budget: a recap is one more model call.
          rateLimit(
            ctx,
            `grade:ip:${clientKey(ctx.request, null)}`,
            30,
            600_000,
          )
          rateLimit(ctx, 'grade:all', 2000, 86_400_000)
          const team = ctx.workspace.visibleTeamBySlug(
            args.teamSlug,
            ctx.viewer?.id ?? null,
          )
          if (!team) throw fail('NOT_FOUND', 'No encontramos ese equipo.')
          const answers = readRecapAnswers(args.answers)
          if (!answers)
            throw fail('INVALID', 'El resumen de la sesión no es válido.')
          if (args.previous == null && args.dispute == null)
            return recapSession(ctx.ai.llm, answers)
          const previous = readRecap(args.previous)
          const dispute = readDispute(args.dispute)
          if (!previous || !dispute)
            throw fail('INVALID', 'La revisión de la lectura no es válida.')
          return recapSession(ctx.ai.llm, answers, { previous, dispute })
        },
      }),
      voiceToken: f.field({
        type: VoiceTokenRef,
        resolve: async (_root, _args, ctx) => {
          if (!ctx.ai.llm || !ctx.ai.voice)
            throw fail('UNAVAILABLE', 'La voz no está disponible.')
          rateLimit(
            ctx,
            `voice:ip:${clientKey(ctx.request, null)}`,
            40,
            600_000,
          )
          try {
            return await mintToken(ctx.ai.voice)
          } catch (e) {
            if (e instanceof VoiceError) throw fail('UNAVAILABLE', e.message)
            throw e
          }
        },
      }),
      logout: f.boolean({
        resolve: async (_root, _args, ctx) => {
          const token = (await ctx.request.cookieStore?.get(SESSION_COOKIE))
            ?.value
          await ctx.accounts.logout(token)
          await ctx.request.cookieStore?.delete({
            name: SESSION_COOKIE,
            path: '/',
          })
          return true
        },
      }),

      createTeam: f.field({
        type: TeamRef,
        args: {
          name: f.arg.string({ required: true }),
          slug: f.arg.string(),
          visibility: f.arg({ type: VisibilityEnum, required: true }),
        },
        resolve: async (_root, args, ctx) => {
          const viewer = need(ctx)
          await creatorAccess(ctx, viewer.id)
          return guard(() =>
            ctx.workspace.createTeam(viewer.id, {
              name: args.name,
              slug: args.slug,
              visibility: args.visibility,
            }),
          )
        },
      }),
      updateTeam: f.field({
        type: TeamRef,
        args: {
          teamId: f.arg.id({ required: true }),
          name: f.arg.string(),
          visibility: f.arg({ type: VisibilityEnum }),
        },
        resolve: (_root, args, ctx) =>
          guard(() =>
            ctx.workspace.updateTeam(need(ctx).id, String(args.teamId), {
              name: args.name,
              visibility: args.visibility,
            }),
          ),
      }),

      addIdentity: f.field({
        type: IdentityRef,
        args: {
          teamId: f.arg.id({ required: true }),
          name: f.arg.string({ required: true }),
          role: f.arg.string({ required: true }),
          sectors: f.arg.string({ required: true }),
        },
        resolve: (_root, args, ctx) =>
          guard(() =>
            ctx.workspace.addIdentity(need(ctx).id, String(args.teamId), {
              name: args.name,
              role: args.role,
              sectors: args.sectors,
            }),
          ),
      }),
      updateIdentity: f.field({
        type: IdentityRef,
        args: {
          teamId: f.arg.id({ required: true }),
          identityId: f.arg.id({ required: true }),
          name: f.arg.string(),
          role: f.arg.string(),
          sectors: f.arg.string(),
        },
        resolve: (_root, args, ctx) =>
          guard(() =>
            ctx.workspace.updateIdentity(
              need(ctx).id,
              String(args.teamId),
              String(args.identityId),
              {
                name: args.name,
                role: args.role,
                sectors: args.sectors,
              },
            ),
          ),
      }),
      removeIdentity: f.boolean({
        args: {
          teamId: f.arg.id({ required: true }),
          identityId: f.arg.id({ required: true }),
        },
        resolve: (_root, args, ctx) =>
          guard(() => {
            ctx.workspace.removeIdentity(
              need(ctx).id,
              String(args.teamId),
              String(args.identityId),
            )
            return true
          }),
      }),

      createInvite: f.field({
        type: InviteToken,
        args: {
          teamId: f.arg.id({ required: true }),
          role: f.arg({ type: RoleEnum, required: true }),
        },
        resolve: (_root, args, ctx) =>
          guard(() =>
            ctx.workspace.createInvite(
              need(ctx).id,
              String(args.teamId),
              args.role,
            ),
          ),
      }),
      revokeInvite: f.boolean({
        args: {
          teamId: f.arg.id({ required: true }),
          inviteId: f.arg.id({ required: true }),
        },
        resolve: (_root, args, ctx) =>
          guard(() => {
            ctx.workspace.revokeInvite(
              need(ctx).id,
              String(args.teamId),
              String(args.inviteId),
            )
            return true
          }),
      }),
      acceptInvite: f.field({
        type: TeamRef,
        args: { token: f.arg.string({ required: true }) },
        resolve: async (_root, args, ctx) => {
          rateLimit(ctx, `invite:${clientKey(ctx.request, null)}`, 20, 900_000)
          const viewer = need(ctx)
          await joinerAccess(ctx, viewer.id)
          return guard(() => ctx.workspace.acceptInvite(viewer.id, args.token))
        },
      }),
      setMemberRole: f.boolean({
        args: {
          teamId: f.arg.id({ required: true }),
          memberId: f.arg.id({ required: true }),
          role: f.arg({ type: RoleEnum, required: true }),
        },
        resolve: (_root, args, ctx) =>
          guard(() => {
            ctx.workspace.setMemberRole(
              need(ctx).id,
              String(args.teamId),
              String(args.memberId),
              args.role,
            )
            return true
          }),
      }),
      removeMember: f.boolean({
        args: {
          teamId: f.arg.id({ required: true }),
          memberId: f.arg.id({ required: true }),
        },
        resolve: (_root, args, ctx) =>
          guard(() => {
            ctx.workspace.removeMember(
              need(ctx).id,
              String(args.teamId),
              String(args.memberId),
            )
            return true
          }),
      }),
      /** Reads the indexed sources and proposes who presents. Creates nothing: the director picks. */
      proposeIdentities: f.field({
        type: [RoleCandidateRef],
        args: { teamId: f.arg.id({ required: true }) },
        resolve: (_root, args, ctx) =>
          guardAsync(async () => {
            const user = need(ctx)
            const teamId = String(args.teamId)
            if (ctx.knowledge.requireMember(teamId, user.id) !== 'director') {
              throw fail(
                'FORBIDDEN',
                'Solo la dirección del equipo puede hacer esto.',
              )
            }
            if (!ctx.ai.llm) {
              throw fail(
                'UNAVAILABLE',
                'La lectura del material no está disponible en este servidor.',
              )
            }
            if (ctx.knowledge.sourceCount(teamId) === 0) {
              throw fail('INVALID', 'Primero indexá una fuente de GitHub.')
            }
            rateLimit(ctx, `roles:${user.id}`, 5, 600_000)
            const passages = await rolePassages(
              { knowledge: ctx.knowledge, embedder: ctx.ai.embedder ?? null },
              user.id,
              teamId,
            )
            let found
            try {
              found = await proposeRoles(ctx.ai.llm, passages)
            } catch (e) {
              if (e instanceof LlmError) throw fail('UNAVAILABLE', e.message)
              throw e
            }
            const have = new Set(
              ctx.catalog
                .identities(teamId)
                .flatMap((i) => [i.name.toLowerCase(), i.key]),
            )
            return found.filter((c) => !have.has(c.name.toLowerCase()))
          }),
      }),
      /** Starts reading the sources to draft the defense. Returns at once; poll `Team.generation`. */
      generateDefense: f.field({
        type: GenerationRef,
        args: { teamId: f.arg.id({ required: true }) },
        resolve: (_root, args, ctx) =>
          guardAsync(async () => {
            const user = need(ctx)
            const teamId = String(args.teamId)
            if (!ctx.ai.llm) {
              throw fail(
                'UNAVAILABLE',
                'La generación no está disponible en este servidor.',
              )
            }
            if (ctx.knowledge.sourceCount(teamId) === 0) {
              throw fail('INVALID', 'Primero indexá una fuente de GitHub.')
            }
            rateLimit(ctx, `generate:${user.id}`, 3, 3_600_000)
            return startGeneration(
              {
                authoring: ctx.authoring,
                knowledge: ctx.knowledge,
                catalog: ctx.catalog,
                llm: ctx.ai.llm,
                embedder: ctx.ai.embedder ?? null,
              },
              user.id,
              teamId,
            )
          }),
      }),
      /** Writes the reviewed draft as the team's points and approved questions. */
      approveDraft: f.field({
        type: ApprovalRef,
        args: {
          teamId: f.arg.id({ required: true }),
          runId: f.arg.id({ required: true }),
          /** Point codes and "code#n" question ids left out. */
          skip: f.arg.stringList({ required: true }),
          /** point code -> identity key (or null for nobody). */
          owners: f.arg({ type: 'JSON', required: true }),
        },
        resolve: (_root, args, ctx) =>
          guard(() =>
            ctx.authoring.approve(
              need(ctx).id,
              String(args.teamId),
              String(args.runId),
              {
                skip: new Set(args.skip),
                owners: ownersOf(args.owners),
              },
            ),
          ),
      }),
      discardDraft: f.boolean({
        args: {
          teamId: f.arg.id({ required: true }),
          runId: f.arg.id({ required: true }),
        },
        resolve: (_root, args, ctx) =>
          guard(() => {
            ctx.authoring.discard(
              need(ctx).id,
              String(args.teamId),
              String(args.runId),
            )
            return true
          }),
      }),
      deleteSource: f.boolean({
        args: {
          teamId: f.arg.id({ required: true }),
          sourceId: f.arg.id({ required: true }),
        },
        resolve: (_root, args, ctx) =>
          guard(() => {
            ctx.knowledge.removeSource(
              need(ctx).id,
              String(args.teamId),
              String(args.sourceId),
            )
            return true
          }),
      }),
      deleteMaterial: f.boolean({
        args: {
          teamId: f.arg.id({ required: true }),
          materialId: f.arg.id({ required: true }),
        },
        resolve: (_root, args, ctx) =>
          guardAsync(async () => {
            await ctx.workspace.deleteMaterial(
              need(ctx).id,
              String(args.teamId),
              String(args.materialId),
            )
            return true
          }),
      }),
    }),
  })

  return builder.toSchema()
}
