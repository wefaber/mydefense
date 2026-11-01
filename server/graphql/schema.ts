import SchemaBuilder from '@pothos/core'
import { GraphQLError } from 'graphql'
import {
  POINT_STATUSES,
  QUESTION_GROUPS,
  RESOURCE_KINDS,
  clampPage,
  type PointStatus,
  type QuestionGroup,
  type ResourceKind,
} from '../../shared/types.ts'
import type { Catalog } from '../db/catalog.ts'
import type * as t from '../db/schema.ts'

export interface Context {
  catalog: Catalog
}

type Team = typeof t.teams.$inferSelect
type Identity = typeof t.identities.$inferSelect
type Defense = typeof t.defenses.$inferSelect
type Section = typeof t.sections.$inferSelect
type Point = typeof t.points.$inferSelect
type Question = typeof t.questions.$inferSelect
type Resource = typeof t.resources.$inferSelect

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
  const QuestionRef = builder.objectRef<Question>('Question')
  const ResourceRef = builder.objectRef<Resource>('Resource')

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

  const TeamRef = builder.objectRef<Team>('Team')
  TeamRef.implement({
    fields: (f) => ({
      id: f.exposeID('id'),
      slug: f.exposeString('slug'),
      name: f.exposeString('name'),
      identities: f.field({
        type: [IdentityRef],
        resolve: (team, _args, ctx) => ctx.catalog.identities(team.id),
      }),
      defense: f.field({
        type: DefenseRef,
        nullable: true,
        resolve: (team, _args, ctx) => ctx.catalog.defense(team.id) ?? null,
      }),
    }),
  })

  builder.queryType({
    fields: (f) => ({
      teams: f.field({
        type: [TeamRef],
        resolve: (_root, _args, ctx) => ctx.catalog.publicTeams(),
      }),
      team: f.field({
        type: TeamRef,
        args: { slug: f.arg.string({ required: true }) },
        resolve: (_root, args, ctx) => {
          const team = ctx.catalog.publicTeamBySlug(args.slug)
          if (!team)
            throw new GraphQLError('Team not found.', {
              extensions: { code: 'NOT_FOUND' },
            })
          return team
        },
      }),
    }),
  })

  return builder.toSchema()
}
