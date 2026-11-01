import SchemaBuilder from '@pothos/core'
import { clientKey, sessionCookie, type AccountUser } from '@wefaber/accounts'
import { GraphQLError } from 'graphql'
import {
  POINT_STATUSES,
  QUESTION_GROUPS,
  RESOURCE_KINDS,
  ROLES,
  VISIBILITIES,
  clampPage,
  type PointStatus,
  type QuestionGroup,
  type ResourceKind,
  type Role,
  type Visibility,
} from '../../shared/types.ts'
import { AccessError } from '../db/workspace.ts'
import type * as t from '../db/schema.ts'
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
      materials: f.field({
        type: [MaterialRef],
        resolve: (team, _args, ctx) =>
          guard(() => ctx.workspace.materials(need(ctx).id, team.id)),
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

  /* --- Queries -------------------------------------------------------------------------------------------- */

  builder.queryType({
    fields: (f) => ({
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
        resolve: (_root, args, ctx) =>
          guard(() =>
            ctx.workspace.createTeam(need(ctx).id, {
              name: args.name,
              slug: args.slug,
              visibility: args.visibility,
            }),
          ),
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
        resolve: (_root, args, ctx) => {
          rateLimit(ctx, `invite:${clientKey(ctx.request, null)}`, 20, 900_000)
          return guard(() =>
            ctx.workspace.acceptInvite(need(ctx).id, args.token),
          )
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
