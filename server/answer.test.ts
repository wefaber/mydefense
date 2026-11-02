import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Llm } from './ai/llm.ts'
import { createApp } from './app.ts'
import { openDb } from './db/connection.ts'
import { runMigrations } from './db/migrate.ts'
import { parseEternumData, seedEternum } from './db/seed-eternum.ts'
import { GITHUB_TEST_CONFIG, githubCookie } from './github-test-session.ts'
import { buildServices, type Ai } from './services.ts'

const source = readFileSync(
  join(import.meta.dir, '..', 'seed', 'eternum', 'data.js'),
  'utf8',
)
const noFiles = { write: async () => {}, remove: async () => {} }
const REPLY = JSON.stringify({
  verdict: 'complete',
  criteria: { content: 4, terminology: 3, structure: 3 },
  covered: ['todo'],
  missing: [],
  unsupported: [],
  feedback: 'Bien.',
})

/** A fresh app with a GitHub-linked session: practice needs one (ADR 0007). */
async function app(ai: Ai) {
  const db = openDb(':memory:')
  runMigrations(db)
  seedEternum(db, parseEternumData(source))
  const services = buildServices(
    { filesDir: '', keyFile: undefined, github: GITHUB_TEST_CONFIG },
    db,
    noFiles,
    ai,
  )
  const server = createApp({
    config: { production: true, distDir: null },
    db,
    services,
  })
  return { server, cookie: await githubCookie(services) }
}

type App = Awaited<ReturnType<typeof app>>

async function gql(a: App, query: string) {
  const res = await a.server.handle(
    new Request('http://localhost/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: a.cookie },
      body: JSON.stringify({ query }),
    }),
  )
  return (await res.json()) as {
    data?: Record<string, any>
    errors?: { message: string; extensions?: { code?: string } }[]
  }
}

const llm = (seen: string[] = []): Llm => ({
  complete: async (_s, user) => (seen.push(user), REPLY),
})
const voice = {
  apiKey: 'k',
  version: 'v',
  fetch: (async () =>
    Response.json({ token: 'tok' })) as unknown as typeof fetch,
}

async function firstQuestionId(a: App) {
  const r = await gql(
    a,
    '{ team(slug: "eternum") { defense { questions(first: 1) { id } } } }',
  )
  return r.data!.team.defense.questions[0].id as string
}

test('capabilities follow the configured providers', async () => {
  const off = await gql(
    await app({ llm: null, voice: null, evidence: null }),
    '{ capabilities { grading voice } }',
  )
  expect(off.data!.capabilities).toEqual({ grading: false, voice: false })
  const on = await gql(
    await app({ llm: llm(), voice, evidence: null }),
    '{ capabilities { grading voice } }',
  )
  expect(on.data!.capabilities).toEqual({ grading: true, voice: true })
})

test('grading is unavailable without a model', async () => {
  const a = await app({ llm: null, voice: null, evidence: null })
  const id = await firstQuestionId(a)
  const r = await gql(
    a,
    `mutation { gradeAnswer(teamSlug: "eternum", questionId: "${id}", answer: "una respuesta larga y completa") { verdict } }`,
  )
  expect(r.errors?.[0]?.extensions?.code).toBe('UNAVAILABLE')
})

test('an answer is graded against the stored reference, and the reference never leaves in the error path', async () => {
  const seen: string[] = []
  const a = await app({ llm: llm(seen), voice, evidence: null })
  const id = await firstQuestionId(a)
  const r = await gql(
    a,
    `mutation { gradeAnswer(teamSlug: "eternum", questionId: "${id}", answer: "Lux centraliza todo lo del ITI en un solo lugar", spokenMs: 8000) {
      verdict criteria { content } feedback delivery { words wpm } } }`,
  )
  expect(r.errors).toBeUndefined()
  expect(r.data!.gradeAnswer.verdict).toBe('complete')
  expect(r.data!.gradeAnswer.delivery.wpm).toBeGreaterThan(0)
  expect(seen[0]).toContain('Respuesta de referencia')
})

test('a question of another team or an unknown id is NOT_FOUND', async () => {
  const a = await app({ llm: llm(), voice, evidence: null })
  const r = await gql(
    a,
    'mutation { gradeAnswer(teamSlug: "eternum", questionId: "nope", answer: "una respuesta larga y completa") { verdict } }',
  )
  expect(r.errors?.[0]?.extensions?.code).toBe('NOT_FOUND')
  const other = await gql(
    a,
    'mutation { gradeAnswer(teamSlug: "no-existe", questionId: "x", answer: "una respuesta larga y completa") { verdict } }',
  )
  expect(other.errors?.[0]?.extensions?.code).toBe('NOT_FOUND')
})

test('grading is rate limited per client', async () => {
  const a = await app({ llm: llm(), voice, evidence: null })
  const id = await firstQuestionId(a)
  const q = `mutation { gradeAnswer(teamSlug: "eternum", questionId: "${id}", answer: "una respuesta larga y completa") { verdict } }`
  let limited = false
  for (let i = 0; i < 35; i++) {
    const r = await gql(a, q)
    if (r.errors?.[0]?.extensions?.code === 'RATE_LIMITED') limited = true
  }
  expect(limited).toBe(true)
})

test('voiceToken returns a short-lived token and is off without a key', async () => {
  const on = await gql(
    await app({ llm: llm(), voice, evidence: null }),
    'mutation { voiceToken { token expiresIn version } }',
  )
  expect(on.data!.voiceToken).toEqual({
    token: 'tok',
    expiresIn: 120,
    version: 'v',
  })
  const off = await gql(
    await app({ llm: llm(), voice: null, evidence: null }),
    'mutation { voiceToken { token } }',
  )
  expect(off.errors?.[0]?.extensions?.code).toBe('UNAVAILABLE')
})
