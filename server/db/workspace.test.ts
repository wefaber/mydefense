import { expect, test } from 'bun:test'
import { createAccounts, createSecretBox } from '@wefaber/accounts'
import { sqliteAccountStore } from './account-store.ts'
import { openDb } from './connection.ts'
import { runMigrations } from './migrate.ts'
import { AccessError, Workspace, type FileStore } from './workspace.ts'

function memoryFiles() {
  const saved = new Map<string, Uint8Array>()
  const store: FileStore = {
    async write(path, bytes) {
      saved.set(path, bytes)
    },
    async remove(path) {
      saved.delete(path)
    },
  }
  return { saved, store }
}

async function setup() {
  const db = openDb(':memory:')
  runMigrations(db)
  const files = memoryFiles()
  let clock = new Date('2026-11-01T12:00:00Z')
  const ws = new Workspace(db, files.store, () => clock)
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
  return {
    db,
    ws,
    files,
    accounts,
    alice: await user('alice'),
    bob: await user('bob'),
    carol: await user('carol'),
    tick: (ms: number) => (clock = new Date(clock.getTime() + ms)),
  }
}

const code = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return e instanceof AccessError ? e.code : `other:${String(e)}`
  }
  return 'none'
}
const codeAsync = async (fn: () => Promise<unknown>) => {
  try {
    await fn()
  } catch (e) {
    return e instanceof AccessError ? e.code : `other:${String(e)}`
  }
  return 'none'
}

const PDF = new TextEncoder().encode('%PDF-1.7\n%fake body')

test('register, login and session round trip over SQLite', async () => {
  const { accounts } = await setup()
  const login = await accounts.login('alice', 'a long enough passphrase 1')
  expect(login.kind).toBe('ok')
  if (login.kind !== 'ok') return
  expect((await accounts.sessionUser(login.session.token))?.handle).toBe(
    'alice',
  )
  await accounts.logout(login.session.token)
  expect(await accounts.sessionUser(login.session.token)).toBeNull()
  expect((await accounts.login('alice', 'wrong wrong wrong')).kind).toBe(
    'invalid',
  )
})

test('creating a team makes the creator director and adds an empty defense', async () => {
  const { ws, alice } = await setup()
  const team = ws.createTeam(alice.id, {
    name: 'Los Cuervos',
    visibility: 'private',
  })
  expect(team.slug).toBe('los-cuervos')
  expect(ws.roleOf(team.id, alice.id)).toBe('director')
  expect(ws.myTeams(alice.id)).toHaveLength(1)
  const second = ws.createTeam(alice.id, {
    name: 'Los Cuervos',
    visibility: 'public',
  })
  expect(second.slug).toBe('los-cuervos-2')
})

test('reserved and malformed slugs are refused', async () => {
  const { ws, alice } = await setup()
  expect(
    code(() =>
      ws.createTeam(alice.id, {
        name: 'Gestion',
        slug: 'gestion',
        visibility: 'public',
      }),
    ),
  ).toBe('INVALID')
  expect(
    code(() => ws.createTeam(alice.id, { name: 'x', visibility: 'public' })),
  ).toBe('INVALID')
  ws.createTeam(alice.id, { name: 'Uno', slug: 'uno', visibility: 'public' })
  expect(
    code(() =>
      ws.createTeam(alice.id, {
        name: 'Otro',
        slug: 'uno',
        visibility: 'public',
      }),
    ),
  ).toBe('CONFLICT')
})

test('private teams exist only for their members', async () => {
  const { ws, alice, bob } = await setup()
  ws.createTeam(alice.id, { name: 'Secreto', visibility: 'private' })
  ws.createTeam(alice.id, { name: 'Abierto', visibility: 'public' })
  expect(ws.visibleTeamBySlug('secreto', alice.id)).toBeDefined()
  expect(ws.visibleTeamBySlug('secreto', bob.id)).toBeUndefined()
  expect(ws.visibleTeamBySlug('secreto', null)).toBeUndefined()
  expect(ws.visibleTeamBySlug('abierto', null)).toBeDefined()
})

test('outsiders get NOT_FOUND and plain members get FORBIDDEN on director actions', async () => {
  const { ws, alice, bob, carol } = await setup()
  const team = ws.createTeam(alice.id, { name: 'Equipo', visibility: 'public' })
  const { token } = ws.createInvite(alice.id, team.id, 'member')
  ws.acceptInvite(bob.id, token)

  for (const act of [
    () => ws.members(carol.id, team.id),
    () => ws.materials(carol.id, team.id),
    () =>
      ws.addIdentity(carol.id, team.id, { name: 'X', role: '', sectors: '' }),
    () => ws.createInvite(carol.id, team.id, 'member'),
    () => ws.updateTeam(carol.id, team.id, { name: 'Hack' }),
  ]) {
    expect(code(act)).toBe('NOT_FOUND')
  }
  for (const act of [
    () => ws.addIdentity(bob.id, team.id, { name: 'X', role: '', sectors: '' }),
    () => ws.createInvite(bob.id, team.id, 'member'),
    () => ws.updateTeam(bob.id, team.id, { name: 'Hack' }),
    () => ws.invites(bob.id, team.id),
  ]) {
    expect(code(act)).toBe('FORBIDDEN')
  }
  expect(ws.members(bob.id, team.id)).toHaveLength(2)
})

test('an identity of one team cannot be touched through another team', async () => {
  const { ws, alice, bob } = await setup()
  const a = ws.createTeam(alice.id, { name: 'Alfa', visibility: 'public' })
  const b = ws.createTeam(bob.id, { name: 'Beta', visibility: 'public' })
  const mine = ws.addIdentity(bob.id, b.id, {
    name: 'Beto',
    role: 'Coord',
    sectors: '',
  })
  expect(
    code(() => ws.updateIdentity(alice.id, a.id, mine.id, { name: 'Pwned' })),
  ).toBe('NOT_FOUND')
  expect(code(() => ws.removeIdentity(alice.id, a.id, mine.id))).toBe(
    'NOT_FOUND',
  )
  expect(
    code(() => ws.updateIdentity(alice.id, b.id, mine.id, { name: 'Pwned' })),
  ).toBe('NOT_FOUND')
})

test('invites are single use, expire, and only the hash is stored', async () => {
  const { ws, db, alice, bob, carol, tick } = await setup()
  const team = ws.createTeam(alice.id, {
    name: 'Equipo',
    visibility: 'private',
  })
  const { token } = ws.createInvite(alice.id, team.id, 'member')
  expect(
    db.$client
      .query('SELECT token_hash FROM invites')
      .all()
      .some((r) => JSON.stringify(r).includes(token)),
  ).toBe(false)

  expect(ws.acceptInvite(bob.id, token).id).toBe(team.id)
  expect(ws.roleOf(team.id, bob.id)).toBe('member')
  expect(code(() => ws.acceptInvite(carol.id, token))).toBe('NOT_FOUND')

  const old = ws.createInvite(alice.id, team.id, 'director')
  tick(8 * 86_400_000)
  expect(code(() => ws.acceptInvite(carol.id, old.token))).toBe('NOT_FOUND')
  expect(code(() => ws.acceptInvite(carol.id, 'not-a-token'))).toBe('NOT_FOUND')
})

test('the last director cannot be demoted, removed or leave', async () => {
  const { ws, alice, bob } = await setup()
  const team = ws.createTeam(alice.id, { name: 'Equipo', visibility: 'public' })
  const mineId = ws.members(alice.id, team.id)[0]!.id
  expect(
    code(() => ws.setMemberRole(alice.id, team.id, mineId, 'member')),
  ).toBe('INVALID')
  expect(code(() => ws.removeMember(alice.id, team.id, mineId))).toBe('INVALID')

  ws.acceptInvite(bob.id, ws.createInvite(alice.id, team.id, 'member').token)
  const bobId = ws
    .members(alice.id, team.id)
    .find((m) => m.userId === bob.id)!.id
  ws.setMemberRole(alice.id, team.id, bobId, 'director')
  ws.setMemberRole(alice.id, team.id, mineId, 'member') // fine: bob is director now
  expect(code(() => ws.removeMember(alice.id, team.id, bobId))).toBe(
    'FORBIDDEN',
  ) // alice is a member now
  ws.removeMember(alice.id, team.id, mineId) // leaving is allowed
  expect(ws.roleOf(team.id, alice.id)).toBeNull()
})

test('materials: type, content and size are checked; storage is team scoped', async () => {
  const { ws, files, alice, bob } = await setup()
  const team = ws.createTeam(alice.id, {
    name: 'Equipo',
    visibility: 'private',
  })
  const other = ws.createTeam(bob.id, { name: 'Otro', visibility: 'private' })

  const saved = await ws.addMaterial(alice.id, team.id, {
    name: 'C:\\fakepath\\informe.pdf',
    bytes: PDF,
  })
  expect(saved.name).toBe('informe.pdf')
  expect(saved.mime).toBe('application/pdf')
  expect([...files.saved.keys()][0]?.startsWith(`${team.id}/`)).toBe(true)

  expect(
    await codeAsync(() =>
      ws.addMaterial(alice.id, team.id, { name: 'virus.exe', bytes: PDF }),
    ),
  ).toBe('INVALID')
  expect(
    await codeAsync(() =>
      ws.addMaterial(alice.id, team.id, {
        name: 'fake.pdf',
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ),
  ).toBe('INVALID')
  expect(
    await codeAsync(() =>
      ws.addMaterial(alice.id, team.id, {
        name: 'a.md',
        bytes: new Uint8Array([104, 0, 105]),
      }),
    ),
  ).toBe('INVALID')
  expect(
    await codeAsync(() =>
      ws.addMaterial(alice.id, team.id, {
        name: 'empty.txt',
        bytes: new Uint8Array(),
      }),
    ),
  ).toBe('INVALID')
  const big = new Uint8Array(10 * 1024 * 1024 + 1).fill(97)
  expect(
    await codeAsync(() =>
      ws.addMaterial(alice.id, team.id, { name: 'big.txt', bytes: big }),
    ),
  ).toBe('INVALID')
  expect(
    await codeAsync(() =>
      ws.addMaterial(bob.id, team.id, { name: 'a.txt', bytes: PDF }),
    ),
  ).toBe('NOT_FOUND')

  expect(
    await codeAsync(() => ws.deleteMaterial(bob.id, other.id, saved.id)),
  ).toBe('NOT_FOUND')
  expect(ws.materials(alice.id, team.id)).toHaveLength(1)
  await ws.deleteMaterial(alice.id, team.id, saved.id)
  expect(files.saved.size).toBe(0)
})
