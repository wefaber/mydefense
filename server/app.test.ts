import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createApp } from './app.ts'
import { openDb } from './db/connection.ts'
import { runMigrations } from './db/migrate.ts'
import { parseEternumData, seedEternum } from './db/seed-eternum.ts'
import { buildServices } from './services.ts'
import { MAX_QUERY_CHARS } from './graphql/limits.ts'
import { GITHUB_TEST_CONFIG, githubCookie } from './github-test-session.ts'

const source = readFileSync(
  join(import.meta.dir, '..', 'seed', 'eternum', 'data.js'),
  'utf8',
)

const noFiles = { write: async () => {}, remove: async () => {} }

/** A fresh app with a GitHub-linked session; `cookie` is empty for an anonymous client. */
async function app() {
  const db = openDb(':memory:')
  runMigrations(db)
  seedEternum(db, parseEternumData(source))
  const services = buildServices(
    { filesDir: '', keyFile: undefined, github: GITHUB_TEST_CONFIG },
    db,
    noFiles,
  )
  const server = createApp({
    config: { production: true, distDir: null },
    db,
    services,
  })
  return { server, cookie: await githubCookie(services) }
}

type App = Awaited<ReturnType<typeof app>>

const gql = (
  a: App,
  query: string,
  method: 'POST' | 'GET' = 'POST',
  cookie = a.cookie,
) =>
  method === 'POST'
    ? a.server.handle(
        new Request('http://localhost/graphql', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ query }),
        }),
      )
    : a.server.handle(
        new Request(
          `http://localhost/graphql?query=${encodeURIComponent(query)}`,
          { headers: { cookie } },
        ),
      )

test('health and ready', async () => {
  const { server } = await app()
  expect(
    (await server.handle(new Request('http://localhost/health'))).status,
  ).toBe(200)
  const ready = await server.handle(new Request('http://localhost/ready'))
  expect(ready.status).toBe(200)
  expect(await ready.json()).toEqual({ status: 'ready' })
})

test('teams and practice need a GitHub sign-in, not only a request', async () => {
  const a = await app()
  const anon = await gql(a, '{ teams { slug } }', 'POST', '')
  const body = (await anon.json()) as {
    errors: { extensions: { code: string } }[]
  }
  expect(body.errors[0]?.extensions.code).toBe('UNAUTHENTICATED')
})

test('graphql lists public teams with their identities', async () => {
  const res = await gql(
    await app(),
    '{ teams { slug name identities { name } } }',
  )
  const body = (await res.json()) as {
    data: { teams: { slug: string; identities: unknown[] }[] }
  }
  expect(body.data.teams).toHaveLength(1)
  expect(body.data.teams[0]?.slug).toBe('eternum')
  expect(body.data.teams[0]?.identities).toHaveLength(4)
})

test('questions are paged and filtered by group', async () => {
  const res = await gql(
    await app(),
    '{ team(slug: "eternum") { defense { bank: questions(group: bank) { id } topics: questions(group: topic, first: 5) { id } all: questions(first: 1000) { id } } } }',
  )
  const body = (await res.json()) as {
    data: {
      team: { defense: { bank: unknown[]; topics: unknown[]; all: unknown[] } }
    }
  }
  const { bank, topics, all } = body.data.team.defense
  expect(bank).toHaveLength(15)
  expect(topics).toHaveLength(5)
  expect(all).toHaveLength(100) // clamped to the page maximum
})

test('unknown team is a NOT_FOUND error with a code', async () => {
  const res = await gql(await app(), '{ team(slug: "nope") { name } }')
  const body = (await res.json()) as {
    errors: { extensions: { code: string } }[]
  }
  expect(body.errors[0]?.extensions.code).toBe('NOT_FOUND')
})

test('deep queries are rejected', async () => {
  const a = await app()
  const ok = await gql(
    a,
    '{ teams { defense { sections { id } points { id } } identities { id } } }',
  )
  expect(await ok.json()).not.toHaveProperty('errors')
  const res = await gql(
    a,
    '{ a { b { c { d { e { f { g { h { i } } } } } } } } }',
  )
  const body = (await res.json()) as {
    errors: { extensions?: { code?: string } }[]
  }
  expect(body.errors.some((e) => e.extensions?.code === 'QUERY_TOO_DEEP')).toBe(
    true,
  )
})

test('oversized queries are rejected', async () => {
  const res = await gql(
    await app(),
    `{ teams { name } }${' '.repeat(MAX_QUERY_CHARS)}`,
  )
  const body = (await res.json()) as {
    errors: { extensions: { code: string } }[]
  }
  expect(body.errors[0]?.extensions.code).toBe('QUERY_TOO_LARGE')
})

test('there are no mutations', async () => {
  const res = await gql(await app(), 'mutation { x }')
  const body = (await res.json()) as { errors: unknown[] }
  expect(body.errors.length).toBeGreaterThan(0)
})
