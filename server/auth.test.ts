import { RECOVERY_COUNT } from '@wefaber/accounts'
import { afterAll, expect, test } from 'bun:test'
import { createApp } from './app.ts'
import { openDb } from './db/connection.ts'
import { runMigrations } from './db/migrate.ts'
import { buildServices } from './services.ts'

const PASSWORD = 'a long enough passphrase 1'
const PDF = new TextEncoder().encode('%PDF-1.7\n%fake body')
const ORG = 'wefaber'
const GITHUB = {
  org: ORG,
  clientId: 'test-client',
  clientSecret: 'test-secret',
  publicUrl: 'http://localhost:5190',
}

/** GitHub as the tests see it. `member: 'error'` makes the membership read fail. */
const people: Record<string, { id: number; member: boolean | 'error' }> = {
  alice: { id: 1, member: true },
  bob: { id: 2, member: false },
  carol: { id: 3, member: false },
  dana: { id: 4, member: true },
  flaky: { id: 5, member: 'error' },
  eve: { id: 6, member: false },
}

/**
 * Stands in for github.com and api.github.com. The code is `code-<login>`, the token `gho_<login>`. Installed for this
 * file only; any other URL fails loudly.
 */
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req =
    input instanceof Request ? input : new Request(String(input), init)
  const url = new URL(req.url)
  if (url.origin === 'https://github.com') {
    if (url.pathname !== '/login/oauth/access_token') {
      return new Response('?', { status: 404 })
    }
    const code = new URLSearchParams(await req.text()).get('code') ?? ''
    const login = code.replace(/^code-/, '')
    if (!people[login]) {
      return Response.json({ error: 'bad_verification_code' }, { status: 400 })
    }
    return Response.json({ access_token: `gho_${login}`, token_type: 'bearer' })
  }
  if (url.origin === 'https://api.github.com') {
    const login = (req.headers.get('authorization') ?? '').replace(
      'Bearer gho_',
      '',
    )
    const person = people[login]
    if (!person) return new Response('{}', { status: 401 })
    if (url.pathname === '/user') return Response.json({ id: person.id, login })
    if (url.pathname === `/user/memberships/orgs/${ORG}`) {
      if (person.member === 'error') {
        return new Response('boom', { status: 500 })
      }
      return person.member
        ? Response.json({ state: 'active', role: 'member' })
        : new Response('{}', { status: 404 })
    }
  }
  return new Response('unexpected request', { status: 599 })
}) as typeof fetch

afterAll(() => {
  globalThis.fetch = realFetch
})

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
    services: buildServices(
      { filesDir: '', keyFile: undefined, github: GITHUB },
      db,
      files,
    ),
  })
  return { server, saved, db }
}

interface Reply {
  data?: Record<string, any>
  errors?: { message: string; extensions?: { code?: string } }[]
}

/** A browser: keeps its cookies between calls. */
function browser(server: ReturnType<typeof app>['server']) {
  const jar = new Map<string, string>()
  let lastSetCookie = ''
  const remember = (res: Response) => {
    for (const line of res.headers.getSetCookie()) {
      lastSetCookie = line
      const [pair = ''] = line.split(';')
      const [name = '', ...rest] = pair.split('=')
      const value = rest.join('=')
      if (/expires=Thu, 01 Jan 1970|max-age=0/i.test(line) || !value) {
        jar.delete(name)
      } else jar.set(name, value)
    }
  }
  const cookieHeader = () =>
    [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
  const cookies = (): Record<string, string> =>
    cookieHeader() ? { cookie: cookieHeader() } : {}

  const self = {
    get setCookie() {
      return lastSetCookie
    },
    get session() {
      return jar.has('md_session')
    },
    async get(path: string): Promise<Response> {
      const res = await server.handle(
        new Request(`http://localhost${path}`, { headers: cookies() }),
      )
      remember(res)
      return res
    },
    /** Starts GitHub sign-in, then comes back with the code GitHub would send. */
    async githubSignIn(login: string, state?: string): Promise<Response> {
      const start = await self.get('/auth/github/start')
      const issued = new URL(start.headers.get('location') ?? '').searchParams
      return self.get(
        `/auth/github/callback?code=code-${login}&state=${state ?? issued.get('state')}`,
      )
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
            ...cookies(),
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
          headers: { ...cookies(), ...headers },
          body: form,
        }),
      )
      return { status: res.status, body: (await res.json()) as any }
    },
  }
  return self
}

const register = (b: ReturnType<typeof browser>, handle: string) =>
  b.gql(
    `mutation { register(handle: "${handle}", displayName: "${handle}", password: "${PASSWORD}") { user { handle } recoveryCodes } }`,
  )

const createTeam = (b: ReturnType<typeof browser>, name: string) =>
  b.gql(
    `mutation { createTeam(name: "${name}", visibility: public) { id slug myRole } }`,
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

test('GitHub sign-in starts at the org-scoped authorization with a state cookie', async () => {
  const b = browser(app().server)
  const res = await b.get('/auth/github/start')
  expect(res.status).toBe(302)
  const to = new URL(res.headers.get('location') ?? '')
  expect(`${to.origin}${to.pathname}`).toBe(
    'https://github.com/login/oauth/authorize',
  )
  expect(to.searchParams.get('client_id')).toBe('test-client')
  expect(to.searchParams.get('scope')).toBe('read:org')
  expect(to.searchParams.get('redirect_uri')).toBe(
    'http://localhost:5190/auth/github/callback',
  )
  expect(to.searchParams.get('state')).toMatch(/.{16,}/)
  expect(b.setCookie).toMatch(/md_oauth=/)
  expect(b.setCookie).toMatch(/HttpOnly/i)
  expect(b.setCookie).toMatch(/SameSite=Lax/i)
  expect(b.setCookie).toMatch(/Path=\/auth\/github/)
})

test('a GitHub member signs in without a password; a GitHub-only account cannot log in with one', async () => {
  const { server } = app()
  const b = browser(server)
  const cb = await b.githubSignIn('alice')
  expect(cb.headers.get('location')).toBe('/cuenta/equipos')
  expect(b.setCookie).toMatch(/md_session=/)
  expect(b.setCookie).toMatch(/HttpOnly/i)
  expect(b.setCookie).toMatch(/Secure/i)
  expect((await b.gql('{ me { handle displayName } }')).data?.me).toEqual({
    handle: 'alice',
    displayName: 'alice',
  })

  const pw = await browser(server).gql(
    `mutation { login(handle: "alice", password: "${PASSWORD}") { handle } }`,
  )
  expect(code(pw)).toBe('INVALID_CREDENTIALS')
})

test('creating a team needs a GitHub sign-in as a member of the org', async () => {
  const { server } = app()
  const password = browser(server)
  await register(password, 'pat')
  expect(code(await createTeam(password, 'Sin GitHub'))).toBe('FORBIDDEN')

  const outsider = browser(server)
  await outsider.githubSignIn('bob')
  const refused = await createTeam(outsider, 'Ajeno')
  expect(code(refused)).toBe('FORBIDDEN')
  expect(refused.errors?.[0]?.message).toContain(ORG)

  const member = browser(server)
  await member.githubSignIn('dana')
  expect((await createTeam(member, 'Propio')).data?.createTeam).toMatchObject({
    slug: 'propio',
    myRole: 'director',
  })
})

test('a membership revoked on GitHub stops team creation at the next sign-in', async () => {
  const { server } = app()
  const b = browser(server)
  await b.githubSignIn('dana')
  expect((await createTeam(b, 'Antes')).data?.createTeam.slug).toBe('antes')

  people.dana!.member = false
  try {
    await b.githubSignIn('dana')
    expect(code(await createTeam(b, 'Despues'))).toBe('FORBIDDEN')
  } finally {
    people.dana!.member = true
  }
})

test('a GitHub login does not merge with a password account of the same name', async () => {
  const { server } = app()
  const password = browser(server)
  await register(password, 'eve')
  const github = browser(server)
  await github.githubSignIn('eve')
  const handle = (await github.gql('{ me { handle } }')).data?.me.handle
  expect(handle).toMatch(/^eve-[a-z0-9]{4}$/)

  const again = await browser(server).gql(
    `mutation { login(handle: "eve", password: "${PASSWORD}") { handle } }`,
  )
  expect(again.data?.login.handle).toBe('eve')
})

test('a failed GitHub check, a forged state or a suspended account sign nobody in', async () => {
  const { server, db } = app()
  const flaky = browser(server)
  const failed = await flaky.githubSignIn('flaky')
  expect(failed.headers.get('location')).toBe('/cuenta/entrar?error=github')
  expect(flaky.session).toBe(false)

  const forged = browser(server)
  await forged.get('/auth/github/start')
  const bad = await forged.githubSignIn('alice', 'forged-state-value')
  expect(bad.headers.get('location')).toBe('/cuenta/entrar?error=github')
  expect(forged.session).toBe(false)

  await browser(server).githubSignIn('carol')
  db.$client.run("update users set status = 'suspended' where handle = 'carol'")
  const suspended = await browser(server).githubSignIn('carol')
  expect(suspended.headers.get('location')).toBe('/cuenta/entrar?error=github')
})

test('the OAuth token is never stored', async () => {
  const { server, db } = app()
  await browser(server).githubSignIn('alice')
  const tables = db.$client
    .query<{ name: string }, []>(
      "select name from sqlite_master where type = 'table'",
    )
    .all()
  for (const { name } of tables) {
    const dump = JSON.stringify(
      db.$client.query(`select * from "${name}"`).all(),
    )
    expect(dump).not.toContain('gho_')
  }
})

test('members of a public team cannot read what only members see, outsiders get NOT_FOUND', async () => {
  const { server } = app()
  const alice = browser(server)
  const carol = browser(server)
  await alice.githubSignIn('alice')
  await carol.githubSignIn('carol')
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

test('private teams and their management data stay behind membership', async () => {
  const { server } = app()
  const alice = browser(server)
  const bob = browser(server)
  const anon = browser(server)
  await alice.githubSignIn('alice')
  await register(bob, 'bob')

  const created = await alice.gql(
    'mutation { createTeam(name: "Secreto", visibility: private) { id slug myRole } }',
  )
  expect(created.data?.createTeam).toMatchObject({
    slug: 'secreto',
    myRole: 'director',
  })

  const carol = browser(server)
  await carol.githubSignIn('carol')
  expect(code(await anon.gql('{ team(slug: "secreto") { name } }'))).toBe(
    'UNAUTHENTICATED',
  )
  expect(code(await bob.gql('{ team(slug: "secreto") { name } }'))).toBe(
    'FORBIDDEN', // a password account cannot read teams (ADR 0007)
  )
  expect(code(await carol.gql('{ team(slug: "secreto") { name } }'))).toBe(
    'NOT_FOUND', // signed in with GitHub, but not a member
  )
  expect(
    (
      await alice.gql(
        '{ team(slug: "secreto") { name members { handle role } } }',
      )
    ).data?.team.members,
  ).toHaveLength(1)
  expect(code(await anon.gql('{ teams { slug } }'))).toBe('UNAUTHENTICATED')

  const invite = await alice.gql(
    `mutation { createInvite(teamId: "${created.data?.createTeam.id}", role: member) { token } }`,
  )
  const token = invite.data?.createInvite.token as string
  expect(
    code(
      await bob.gql(`mutation { acceptInvite(token: "${token}") { slug } }`),
    ),
  ).toBe('FORBIDDEN') // a password account cannot join by invite
  await bob.githubSignIn('bob')
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

test('uploads need a session, membership, a valid file and a same-site origin', async () => {
  const { server, saved } = app()
  const alice = browser(server)
  const bob = browser(server)
  const anon = browser(server)
  await alice.githubSignIn('alice')
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
