import { expect, test } from 'bun:test'
import { createAccounts, createSecretBox } from '@wefaber/accounts'
import { EmbedderUnavailableError } from '@wefaber/embed'
import type { Embedder } from './ai/embedder.ts'
import { sqliteAccountStore } from './db/account-store.ts'
import { openDb } from './db/connection.ts'
import { Knowledge, MAX_SOURCES_PER_TEAM } from './db/knowledge.ts'
import { runMigrations } from './db/migrate.ts'
import { Workspace, type FileStore } from './db/workspace.ts'
import { githubStub } from './github-stub.ts'
import {
  chunkText,
  ftsMatch,
  searchKnowledge,
  syncRepo,
  titleOf,
} from './knowledge.ts'
import { createRepoImporter } from './repo-import.ts'

const SESIONES =
  'Las sesiones de usuario se guardan en una tabla y el token viaja en una cookie HttpOnly con vencimiento.'
const DATOS =
  'La base de datos usa SQLite con migraciones expand y contract para poder desplegar en azul y verde.'
const AUTH =
  'La autenticación de la aplicación se apoya en GitHub y en contraseñas con Argon2id para quienes no usan GitHub.'

const docs = (): Record<string, string> => ({
  'README.md': `# Eternum\n\n${AUTH}`,
  'docs/sesiones.md': SESIONES,
  'docs/datos.md': DATOS,
  'docs/imagen.png': 'binary',
  'docs/corto.md': 'muy corto',
})

/** Two topics: sessions/login and storage. A zero vector points to a third axis. */
const TOPICS = [
  ['sesion', 'sesiones', 'login', 'cookie'],
  ['datos', 'sqlite', 'tabla', 'migraciones'],
]
function vectorOf(text: string): Float32Array {
  const lower = text.toLowerCase()
  const v = TOPICS.map((words) => words.filter((w) => lower.includes(w)).length)
  const n = Math.hypot(...v)
  return n === 0
    ? Float32Array.of(0, 0, 1)
    : Float32Array.of(...v.map((x) => x / n), 0)
}

function fakeEmbedder(opts: { down?: () => boolean } = {}) {
  const seen: string[] = []
  const embedder: Embedder = {
    model: 'fake-1',
    async docs(items) {
      if (opts.down?.()) throw new EmbedderUnavailableError('down')
      seen.push(...items.map((i) => i.text))
      return items.map((i) => vectorOf(i.text))
    },
    async query(text) {
      if (opts.down?.()) throw new EmbedderUnavailableError('down')
      return vectorOf(text)
    },
  }
  return { embedder, seen }
}

async function setup(
  files: () => Record<string, string> = docs,
  calls: string[] = [],
) {
  const db = openDb(':memory:')
  runMigrations(db)
  const store: FileStore = { async write() {}, async remove() {} }
  const ws = new Workspace(db, store)
  const knowledge = new Knowledge(db)
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
  const importer = createRepoImporter(
    { org: 'wefaber', token: 'tok' },
    githubStub(files, calls),
  )
  return { db, knowledge, alice, bob, team, importer }
}

test('chunkText splits long text with overlap and drops crumbs', () => {
  expect(chunkText('corto')).toEqual([])
  const long = Array.from(
    { length: 60 },
    (_, i) => `Oración número ${i} del documento.`,
  ).join(' ')
  const pieces = chunkText(long, 300, 50)
  expect(pieces.length).toBeGreaterThan(3)
  expect(pieces.every((p) => p.length <= 300)).toBe(true)
  expect(chunkText(long, 300, 50, 2)).toHaveLength(2)
  expect(titleOf('docs/modelo-de-datos.md')).toBe('modelo de datos')
})

test('ftsMatch quotes every word, so operators in the question cannot break the query', () => {
  expect(ftsMatch('¿Cómo se guarda la sesión?')).toBe(
    '"cómo"* OR "se"* OR "guarda"* OR "la"* OR "sesión"*',
  )
  expect(ftsMatch('"; DROP TABLE x -- OR (')).toBe(
    '"drop"* OR "table"* OR "or"*',
  )
  expect(ftsMatch('?!')).toBe('')
})

test('a first sync indexes the text files and a word search finds them', async () => {
  const { knowledge, alice, team, importer } = await setup()
  const result = await syncRepo(
    { knowledge, importer, embedder: null },
    alice.id,
    team.id,
    { repo: 'wefaber/eternum-docs' },
  )
  expect(result).toMatchObject({
    added: 4,
    updated: 0,
    removed: 0,
    embedderDown: false,
  })
  // `corto.md` is a file with no chunk worth keeping; it is still a file of the source.
  expect(result.source).toMatchObject({
    repo: 'eternum-docs',
    folder: '',
    ref: 'HEAD',
    fileCount: 4,
    chunkCount: 3,
    embeddedCount: 0,
  })

  const found = await searchKnowledge(
    { knowledge, embedder: null },
    alice.id,
    team.id,
    'sesiones cookie',
  )
  expect(found.semantic).toBe(false)
  expect(found.hits[0]).toMatchObject({
    path: 'docs/sesiones.md',
    via: 'words',
  })
  // Accents do not matter.
  const accent = await searchKnowledge(
    { knowledge, embedder: null },
    alice.id,
    team.id,
    'autenticacion',
  )
  expect(accent.hits[0]?.path).toBe('README.md')
})

test('a re-sync fetches only what changed and forgets what disappeared', async () => {
  let current = docs()
  const calls: string[] = []
  const { knowledge, alice, team, importer } = await setup(() => current, calls)
  const deps = { knowledge, importer, embedder: null }
  const spec = { repo: 'eternum-docs' }
  await syncRepo(deps, alice.id, team.id, spec)

  calls.length = 0
  const same = await syncRepo(deps, alice.id, team.id, spec)
  expect(same).toMatchObject({ added: 0, updated: 0, removed: 0, unchanged: 4 })
  expect(calls.filter((c) => c.includes('/contents/'))).toHaveLength(0)

  current = {
    ...current,
    'docs/sesiones.md': `${SESIONES} Ahora también hay refresh tokens rotativos.`,
  }
  delete current['docs/datos.md']
  calls.length = 0
  const next = await syncRepo(deps, alice.id, team.id, spec)
  expect(next).toMatchObject({ added: 0, updated: 1, removed: 1, unchanged: 2 })
  expect(calls.filter((c) => c.includes('/contents/'))).toHaveLength(1)
  expect(next.source.chunkCount).toBe(2)

  const gone = await searchKnowledge(
    deps,
    alice.id,
    team.id,
    'sqlite migraciones',
  )
  expect(gone.hits).toEqual([])
  const fresh = await searchKnowledge(
    deps,
    alice.id,
    team.id,
    'refresh rotativos',
  )
  expect(fresh.hits[0]?.path).toBe('docs/sesiones.md')
  expect(fresh.hits).toHaveLength(1)
})

test('with the embedder, chunks get vectors and a search finds meaning without shared words', async () => {
  const { knowledge, alice, team, importer } = await setup()
  const { embedder } = fakeEmbedder()
  const deps = { knowledge, importer, embedder }
  const result = await syncRepo(deps, alice.id, team.id, {
    repo: 'eternum-docs',
  })
  expect(result.source).toMatchObject({ chunkCount: 3, embeddedCount: 3 })

  // "login" appears in no chunk: only the vectors connect it to the sessions document.
  const found = await searchKnowledge(deps, alice.id, team.id, 'login')
  expect(found.semantic).toBe(true)
  expect(found.hits[0]).toMatchObject({
    path: 'docs/sesiones.md',
    via: 'meaning',
  })
})

test('a down embedder still indexes by words, and the next sync fills in the vectors', async () => {
  let down = true
  const { knowledge, alice, team, importer } = await setup()
  const { embedder } = fakeEmbedder({ down: () => down })
  const deps = { knowledge, importer, embedder }
  const spec = { repo: 'eternum-docs' }

  const first = await syncRepo(deps, alice.id, team.id, spec)
  expect(first.embedderDown).toBe(true)
  expect(first.source).toMatchObject({ chunkCount: 3, embeddedCount: 0 })
  const words = await searchKnowledge(deps, alice.id, team.id, 'cookie')
  expect(words).toMatchObject({ semantic: false })
  expect(words.hits[0]?.path).toBe('docs/sesiones.md')

  down = false
  const second = await syncRepo(deps, alice.id, team.id, spec)
  expect(second.embedderDown).toBe(false)
  expect(second.source.embeddedCount).toBe(3)
  const found = await searchKnowledge(deps, alice.id, team.id, 'login')
  expect(found.hits[0]).toMatchObject({
    path: 'docs/sesiones.md',
    via: 'meaning',
  })
})

test('a chunk the team already embedded is not embedded again', async () => {
  const current: Record<string, string> = {
    ...docs(),
    'docs/copia.md': SESIONES,
  }
  const { knowledge, alice, team, importer } = await setup(() => current)
  const { embedder, seen } = fakeEmbedder()
  await syncRepo({ knowledge, importer, embedder }, alice.id, team.id, {
    repo: 'eternum-docs',
  })
  // `copia.md` and `sesiones.md` differ only by title, so both are embedded: the hash includes the title.
  expect(seen.filter((t) => t === SESIONES)).toHaveLength(2)

  const second = await syncRepo(
    { knowledge, importer, embedder },
    alice.id,
    team.id,
    {
      repo: 'eternum-docs',
      path: 'docs',
    },
  )
  expect(second.source.folder).toBe('docs')
  // Same files under another source: every chunk is reused, none goes back to the embedder.
  expect(seen.filter((t) => t === SESIONES)).toHaveLength(2)
  expect(second.source.embeddedCount).toBe(second.source.chunkCount)
})

test('only members can sync, list and search; removal is for the director or the importer', async () => {
  const { knowledge, alice, bob, team, importer } = await setup()
  const deps = { knowledge, importer, embedder: null }
  await expect(
    syncRepo(deps, bob.id, team.id, { repo: 'eternum-docs' }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  await syncRepo(deps, alice.id, team.id, { repo: 'eternum-docs' })
  expect(() => knowledge.sources(bob.id, team.id)).toThrow()
  await expect(
    searchKnowledge(deps, bob.id, team.id, 'sesiones'),
  ).rejects.toThrow()

  const [source] = knowledge.sources(alice.id, team.id)
  expect(() => knowledge.removeSource(bob.id, team.id, source!.id)).toThrow()
  knowledge.removeSource(alice.id, team.id, source!.id)
  expect(knowledge.sources(alice.id, team.id)).toEqual([])
  const after = await searchKnowledge(deps, alice.id, team.id, 'sesiones')
  expect(after.hits).toEqual([])
})

test('a team has a limited number of sources', async () => {
  const { knowledge, alice, team, importer } = await setup()
  const deps = { knowledge, importer, embedder: null }
  for (let i = 0; i < MAX_SOURCES_PER_TEAM; i++) {
    await syncRepo(deps, alice.id, team.id, {
      repo: 'eternum-docs',
      ref: `rama-${i}`,
    })
  }
  await expect(
    syncRepo(deps, alice.id, team.id, { repo: 'eternum-docs', ref: 'una-mas' }),
  ).rejects.toThrow(/fuentes/)
})
