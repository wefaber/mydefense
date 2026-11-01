import { RECOVERY_COUNT } from '@wefaber/accounts'
import { expect, test } from 'bun:test'
import { createApp } from './app.ts'
import { openDb } from './db/connection.ts'
import { runMigrations } from './db/migrate.ts'
import { buildServices } from './services.ts'

const PASSWORD = 'a long enough passphrase 1'
const PDF = new TextEncoder().encode('%PDF-1.7\n%fake body')

function app() {
  const db = openDb(':memory:')
  runMigrations(db)
  const saved = new Map<string, Uint8Array>()
  const files = {
    write: async (path: string, bytes: Uint8Array) =>
      void saved.set(path, bytes),
    remove: async (path: string) => void saved.delete(path),
  }
  const server = createApp({
    config: { production: true, distDir: null },
    db,
    services: buildServices({ filesDir: '', keyFile: undefined }, db, files),
  })
  return { server, saved }
}

interface Reply {
  data?: Record<string, any>
  errors?: { message: string; extensions?: { code?: string } }[]
}

/** A browser: keeps the session cookie between calls. */
function browser(server: ReturnType<typeof app>['server']) {
  let cookie = ''
  let lastSetCookie = ''
  const remember = (res: Response) => {
    const set = res.headers.getSetCookie()
    for (const line of set) {
      lastSetCookie = line
      const [pair = ''] = line.split(';')
      const [name = '', value = ''] = pair.split('=')
      if (name === 'md_session')
        cookie =
          /expires=Thu, 01 Jan 1970|max-age=0/i.test(line) || !value ? '' : pair
    }
  }
  return {
    get setCookie() {
      return lastSetCookie
    },
    async gql(
      query: string,
      headers: Record<string, string> = {},
    ): Promise<Reply> {
      const res = await server.handle(
        new Request('http://localhost/graphql', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(cookie ? { cookie } : {}),
            ...headers,
          },
          body: JSON.stringify({ query }),
        }),
      )
      remember(res)
      return (await res.json()) as Reply
    },
    async upload(
      slug: string,
      name: string,
      bytes: Uint8Array,
      headers: Record<string, string> = {},
    ) {
      const form = new FormData()
      form.set('file', new File([bytes as BlobPart], name))
      const res = await server.handle(
        new Request(`http://localhost/api/teams/${slug}/materials`, {
          method: 'POST',
          headers: { ...(cookie ? { cookie } : {}), ...headers },
          body: form,
        }),
      )
      return { status: res.status, body: (await res.json()) as any }
    },
  }
}

const register = (b: ReturnType<typeof browser>, handle: string) =>
  b.gql(
    `mutation { register(handle: "${handle}", displayName: "${handle}", password: "${PASSWORD}") { user { handle } recoveryCodes } }`,
  )

const code = (r: Reply) => r.errors?.[0]?.extensions?.code

test('register signs in with an HttpOnly Lax cookie and its recovery codes', async () => {
  const b = browser(app().server)
  const res = await register(b, 'alice')
  expect(res.data?.register.user.handle).toBe('alice')
  expect(res.data?.register.recoveryCodes).toHaveLength(RECOVERY_COUNT)
  expect(b.setCookie).toMatch(/md_session=/)
  expect(b.setCookie).toMatch(/HttpOnly/i)
  expect(b.setCookie).toMatch(/SameSite=Lax/i)
  expect(b.setCookie).toMatch(/Secure/i)
  expect(b.setCookie).toMatch(/Path=\//)
  expect((await b.gql('{ me { handle } }')).data?.me.handle).toBe('alice')
})

test('logout ends the session; wrong passwords look the same as unknown handles', async () => {
  const { server } = app()
  const b = browser(server)
  await register(b, 'alice')
  await b.gql('mutation { logout }')
  expect((await b.gql('{ me { handle } }')).data?.me).toBeNull()

  const wrong = await b.gql(
    'mutation { login(handle: "alice", password: "nope nope nope") { handle } }',
  )
  const unknown = await b.gql(
    'mutation { login(handle: "ghost", password: "nope nope nope") { handle } }',
  )
  expect(code(wrong)).toBe('INVALID_CREDENTIALS')
  expect(wrong.errors?.[0]?.message).toBe(unknown.errors?.[0]?.message)

  const ok = await b.gql(
    `mutation { login(handle: "ALICE", password: "${PASSWORD}") { handle } }`,
  )
  expect(ok.data?.login.handle).toBe('alice')
})

test('login attempts per handle are rate limited', async () => {
  const b = browser(app().server)
  await register(b, 'alice')
  let last: Reply = {}
  for (let i = 0; i < 12; i++) {
    last = await b.gql(
      'mutation { login(handle: "alice", password: "wrong wrong wrong") { handle } }',
    )
  }
  expect(code(last)).toBe('RATE_LIMITED')
})

test('weak passwords and taken handles are refused with INVALID', async () => {
  const b = browser(app().server)
  const weak = await b.gql(
    'mutation { register(handle: "bob", displayName: "Bob", password: "short") { user { id } } }',
  )
  expect(code(weak)).toBe('INVALID')
  await register(b, 'alice')
  const dup = await register(browser(app().server), 'alice') // different app: fine
  expect(dup.errors).toBeUndefined()
  const taken = await b.gql(
    `mutation { register(handle: "alice", displayName: "A", password: "${PASSWORD}") { user { id } } }`,
  )
  expect(code(taken)).toBe('INVALID')
})

test('anonymous users cannot write', async () => {
  const b = browser(app().server)
  const res = await b.gql(
    'mutation { createTeam(name: "Equipo", visibility: public) { id } }',
  )
  expect(code(res)).toBe('UNAUTHENTICATED')
})

test('private teams and their management data stay behind membership', async () => {
  const { server } = app()
  const alice = browser(server)
  const bob = browser(server)
  const anon = browser(server)
  await register(alice, 'alice')
  await register(bob, 'bob')

  const created = await alice.gql(
    'mutation { createTeam(name: "Secreto", visibility: private) { id slug myRole } }',
  )
  expect(created.data?.createTeam).toMatchObject({
    slug: 'secreto',
    myRole: 'director',
  })

  for (const who of [anon, bob]) {
    expect(code(await who.gql('{ team(slug: "secreto") { name } }'))).toBe(
      'NOT_FOUND',
    )
  }
  expect(
    (
      await alice.gql(
        '{ team(slug: "secreto") { name members { handle role } } }',
      )
    ).data?.team.members,
  ).toHaveLength(1)
  expect((await anon.gql('{ teams { slug } }')).data?.teams).toHaveLength(0)

  const invite = await alice.gql(
    `mutation { createInvite(teamId: "${created.data?.createTeam.id}", role: member) { token } }`,
  )
  const token = invite.data?.createInvite.token as string
  const joined = await bob.gql(
    `mutation { acceptInvite(token: "${token}") { slug myRole } }`,
  )
  expect(joined.data?.acceptInvite).toMatchObject({
    slug: 'secreto',
    myRole: 'member',
  })
  expect(
    (await bob.gql('{ team(slug: "secreto") { name } }')).data?.team.name,
  ).toBe('Secreto')
  expect(
    code(
      await bob.gql(
        `mutation { createInvite(teamId: "${created.data?.createTeam.id}", role: member) { token } }`,
      ),
    ),
  ).toBe('FORBIDDEN')
  expect(
    code(
      await anon.gql(`mutation { acceptInvite(token: "${token}") { slug } }`),
    ),
  ).toBe('UNAUTHENTICATED')
})

test('members of a public team cannot read what only members see, outsiders get NOT_FOUND', async () => {
  const { server } = app()
  const alice = browser(server)
  const carol = browser(server)
  await register(alice, 'alice')
  await register(carol, 'carol')
  await alice.gql(
    'mutation { createTeam(name: "Abierto", visibility: public) { id } }',
  )
  expect(
    (await carol.gql('{ team(slug: "abierto") { name } }')).data?.team.name,
  ).toBe('Abierto')
  expect(
    code(await carol.gql('{ team(slug: "abierto") { members { handle } } }')),
  ).toBe('NOT_FOUND')
  expect(
    code(await carol.gql('{ team(slug: "abierto") { materials { name } } }')),
  ).toBe('NOT_FOUND')
})

test('uploads need a session, membership, a valid file and a same-site origin', async () => {
  const { server, saved } = app()
  const alice = browser(server)
  const bob = browser(server)
  const anon = browser(server)
  await register(alice, 'alice')
  await register(bob, 'bob')
  await alice.gql(
    'mutation { createTeam(name: "Equipo", visibility: public) { id } }',
  )

  expect((await anon.upload('equipo', 'a.pdf', PDF)).status).toBe(401)
  expect((await bob.upload('equipo', 'a.pdf', PDF)).status).toBe(404) // public but not a member
  expect((await alice.upload('equipo', 'a.exe', PDF)).status).toBe(400)
  expect(
    (await alice.upload('equipo', 'a.pdf', new Uint8Array([1, 2, 3]))).status,
  ).toBe(400)
  expect((await alice.upload('nope', 'a.pdf', PDF)).status).toBe(404)
  expect(
    (
      await alice.upload('equipo', 'a.pdf', PDF, {
        origin: 'http://evil.example',
      })
    ).status,
  ).toBe(403)

  const ok = await alice.upload('equipo', 'informe.pdf', PDF)
  expect(ok.status).toBe(201)
  expect(ok.body.material.name).toBe('informe.pdf')
  expect(saved.size).toBe(1)
  expect(
    (await alice.gql('{ team(slug: "equipo") { materials { name size } } }'))
      .data?.team.materials,
  ).toEqual([{ name: 'informe.pdf', size: PDF.length }])
})

test('cross-site GraphQL writes are refused', async () => {
  const b = browser(app().server)
  const res = await b.gql(
    `mutation { register(handle: "mallory", displayName: "M", password: "${PASSWORD}") { user { id } } }`,
    { origin: 'http://evil.example' },
  )
  expect(JSON.stringify(res)).toContain('CROSS_SITE')
})
