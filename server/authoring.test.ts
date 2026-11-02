import { expect, test } from 'bun:test'
import { createAccounts, createSecretBox } from '@wefaber/accounts'
import { OUTLINE_SYSTEM, POINT_SYSTEM, type Draft } from './ai/author.ts'
import type { Llm } from './ai/llm.ts'
import { LlmError } from './ai/llm.ts'
import { runGeneration, startGeneration } from './authoring.ts'
import { sqliteAccountStore } from './db/account-store.ts'
import { Authoring } from './db/authoring.ts'
import { Catalog } from './db/catalog.ts'
import { openDb } from './db/connection.ts'
import { Knowledge } from './db/knowledge.ts'
import { runMigrations } from './db/migrate.ts'
import { Workspace } from './db/workspace.ts'
import { githubStub } from './github-stub.ts'
import { syncRepo } from './knowledge.ts'
import { createRepoImporter } from './repo-import.ts'

const SESIONES =
  'Las sesiones de usuario se guardan en una tabla y el token viaja en una cookie HttpOnly con vencimiento.'
const DATOS =
  'La base de datos usa SQLite con migraciones expand y contract para poder desplegar en azul y verde.'

const DOCS: Record<string, string> = {
  'docs/sesiones.md': SESIONES,
  'docs/datos.md': DATOS,
}

const OUTLINE = JSON.stringify({
  sections: [
    {
      title: 'Arquitectura',
      points: [
        { title: 'Sesiones', paths: ['docs/sesiones.md'], owner: 'facundo' },
        { title: 'Datos', paths: ['docs/datos.md'], owner: 'nadie' },
      ],
    },
  ],
})

const point = (evidence: string) =>
  JSON.stringify({
    script: 'Lo explicamos así.',
    say: ['Idea uno', 'Idea dos'],
    status: 'ok',
    todo: '',
    questions: [
      {
        prompt: 'Pregunta',
        modelAnswer: 'Respuesta modelo.',
        source: 1,
        evidence,
      },
    ],
  })

/** The model, by the stage it is asked for. `fail` makes a point's call throw. */
function fakeLlm(
  opts: { fail?: (user: string) => boolean; outline?: string } = {},
) {
  const calls: { stage: string }[] = []
  const llm: Llm = {
    async complete(system, user) {
      if (system === OUTLINE_SYSTEM) {
        calls.push({ stage: 'outline' })
        return opts.outline ?? OUTLINE
      }
      expect(system).toBe(POINT_SYSTEM)
      calls.push({ stage: 'point' })
      if (opts.fail?.(user)) throw new LlmError('caído')
      return user.includes('Punto: Sesiones')
        ? point('el token viaja en una cookie HttpOnly')
        : point('SQLite con migraciones expand y contract')
    },
  }
  return { llm, calls }
}

async function setup() {
  const db = openDb(':memory:')
  runMigrations(db)
  const ws = new Workspace(db, { async write() {}, async remove() {} })
  const knowledge = new Knowledge(db)
  const authoring = new Authoring(db)
  const catalog = new Catalog(db)
  const accounts = createAccounts({
    store: sqliteAccountStore(db),
    box: createSecretBox({}),
    issuer: 'MyDefense',
  })
  const user = async (handle: string) => {
    const res = await accounts.register({
      handle,
      displayName: handle,
      password: 'a long enough passphrase 1',
    })
    if (!res.ok) throw new Error(res.error)
    return res.value.user
  }
  const alice = await user('alice')
  const bob = await user('bob')
  const team = ws.createTeam(alice.id, {
    name: 'Equipo',
    visibility: 'private',
  })
  ws.addIdentity(alice.id, team.id, {
    name: 'Facundo',
    role: 'Coordinador',
    sectors: 'Frontend',
  })
  const importer = createRepoImporter(
    { org: 'wefaber', token: 'tok' },
    githubStub(() => DOCS),
  )
  await syncRepo({ knowledge, importer, embedder: null }, alice.id, team.id, {
    repo: 'eternum-docs',
  })
  const deps = (llm: Llm) => ({
    authoring,
    knowledge,
    catalog,
    llm,
    embedder: null,
  })
  return { db, ws, knowledge, authoring, catalog, alice, bob, team, deps }
}

const draftOf = (run: { draft: unknown } | undefined) => run?.draft as Draft

test('a generation drafts sections, points and quoted questions without publishing anything', async () => {
  const { authoring, catalog, alice, team, deps } = await setup()
  const { llm, calls } = fakeLlm()
  const run = authoring.start(alice.id, team.id)
  await runGeneration(deps(llm), alice.id, team.id, run.id)

  const done = authoring.latest(alice.id, team.id)!
  expect(done).toMatchObject({
    status: 'ready',
    phase: 'points',
    total: 2,
    done: 2,
  })
  expect(calls.filter((c) => c.stage === 'outline')).toHaveLength(1)
  expect(calls.filter((c) => c.stage === 'point')).toHaveLength(2)

  const draft = draftOf(done)
  expect(draft.sections).toHaveLength(1)
  const [sesiones, datos] = draft.sections[0]!.points
  expect(sesiones).toMatchObject({
    code: '1.1',
    owner: 'facundo',
    status: 'ok',
  })
  expect(sesiones!.questions[0]).toMatchObject({
    path: 'docs/sesiones.md',
    evidence: 'el token viaja en una cookie HttpOnly',
  })
  // The owner the model made up is dropped.
  expect(datos).toMatchObject({ code: '1.2', owner: null })

  // Nothing is public until a director approves.
  expect(catalog.points(team.id)).toHaveLength(0)
  expect(catalog.questions(team.id, null, 100, 0)).toHaveLength(0)
})

test('approving writes points and approved questions, honours the review, and happens once', async () => {
  const { authoring, catalog, alice, team, deps } = await setup()
  const run = authoring.start(alice.id, team.id)
  await runGeneration(deps(fakeLlm().llm), alice.id, team.id, run.id)

  const facundo = catalog.identities(team.id)[0]!
  const result = authoring.approve(alice.id, team.id, run.id, {
    skip: new Set(['1.2']),
    owners: { '1.1': 'facundo' },
  })
  expect(result).toEqual({ points: 1, questions: 1 })

  const [p] = catalog.points(team.id)
  expect(p).toMatchObject({ code: '1.1', ownerId: facundo.id, status: 'ok' })
  expect(catalog.sections(team.id)).toHaveLength(1)
  const [q] = catalog.questions(team.id, 'point', 10, 0)
  expect(q).toMatchObject({
    pointId: p!.id,
    status: 'approved',
    source: 'Punto 1.1',
  })
  expect(q!.validatorNotes).toContain('docs/sesiones.md')

  expect(authoring.latest(alice.id, team.id)!.status).toBe('approved')
  expect(() =>
    authoring.approve(alice.id, team.id, run.id, {
      skip: new Set(),
      owners: {},
    }),
  ).toThrow()
  // A team with points cannot generate another defense on top.
  expect(() => authoring.start(alice.id, team.id)).toThrow(/ya tiene puntos/)
})

test('skipping a question leaves the point without it, and an owner can be reassigned or cleared', async () => {
  const { authoring, catalog, alice, team, deps } = await setup()
  const run = authoring.start(alice.id, team.id)
  await runGeneration(deps(fakeLlm().llm), alice.id, team.id, run.id)
  const result = authoring.approve(alice.id, team.id, run.id, {
    skip: new Set(['1.1#0']),
    owners: { '1.1': null },
  })
  expect(result).toEqual({ points: 2, questions: 1 })
  expect(
    catalog.points(team.id).find((p) => p.code === '1.1')!.ownerId,
  ).toBeNull()
})

test('a point the model fails on is kept empty and marked, and the rest goes on', async () => {
  const { authoring, alice, team, deps } = await setup()
  const run = authoring.start(alice.id, team.id)
  await runGeneration(
    deps(fakeLlm({ fail: (u) => u.includes('Punto: Datos') }).llm),
    alice.id,
    team.id,
    run.id,
  )
  const done = authoring.latest(alice.id, team.id)!
  expect(done.status).toBe('ready')
  const [sesiones, datos] = draftOf(done).sections[0]!.points
  expect(sesiones!.status).toBe('ok')
  expect(datos).toMatchObject({ status: 'fill', script: '', questions: [] })
  expect(datos!.todo).toContain('completalo')
})

test('the run fails, with a reason, when the model is down or the outline is empty', async () => {
  const a = await setup()
  const r1 = a.authoring.start(a.alice.id, a.team.id)
  await runGeneration(
    a.deps(fakeLlm({ fail: () => true }).llm),
    a.alice.id,
    a.team.id,
    r1.id,
  )
  expect(a.authoring.latest(a.alice.id, a.team.id)).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('no respondió'),
  })

  const b = await setup()
  const r2 = b.authoring.start(b.alice.id, b.team.id)
  await runGeneration(
    b.deps(fakeLlm({ outline: '{"sections":[]}' }).llm),
    b.alice.id,
    b.team.id,
    r2.id,
  )
  expect(b.authoring.latest(b.alice.id, b.team.id)).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('índice'),
  })
  // A failed run can be followed by a new one.
  expect(() => b.authoring.start(b.alice.id, b.team.id)).not.toThrow()
})

test('only a director starts, sees, approves or discards; one run at a time', async () => {
  const { ws, authoring, alice, bob, team, deps } = await setup()
  expect(() => authoring.start(bob.id, team.id)).toThrow()
  ws.createInvite(alice.id, team.id, 'member')
  const run = authoring.start(alice.id, team.id)
  expect(() => authoring.start(alice.id, team.id)).toThrow(/en curso/)
  expect(() => authoring.latest(bob.id, team.id)).toThrow()
  expect(() => authoring.discard(alice.id, team.id, run.id)).toThrow(
    /ya no se puede/,
  )

  await runGeneration(deps(fakeLlm().llm), alice.id, team.id, run.id)
  expect(() =>
    authoring.approve(bob.id, team.id, run.id, { skip: new Set(), owners: {} }),
  ).toThrow()
  authoring.discard(alice.id, team.id, run.id)
  expect(authoring.latest(alice.id, team.id)).toMatchObject({
    status: 'discarded',
    draft: null,
  })
})

test('startGeneration returns at once and a restart marks an orphan run as failed', async () => {
  const { authoring, alice, team, deps } = await setup()
  const { llm } = fakeLlm()
  const run = startGeneration(deps(llm), alice.id, team.id)
  expect(run.status).toBe('running')
  // Let the background job finish.
  for (
    let i = 0;
    i < 50 && authoring.latest(alice.id, team.id)!.status === 'running';
    i++
  ) {
    await Bun.sleep(10)
  }
  expect(authoring.latest(alice.id, team.id)!.status).toBe('ready')

  const again = await setup()
  const orphan = again.authoring.start(again.alice.id, again.team.id)
  expect(again.authoring.failStale()).toBe(1)
  expect(again.authoring.latest(again.alice.id, again.team.id)).toMatchObject({
    id: orphan.id,
    status: 'failed',
  })
})
