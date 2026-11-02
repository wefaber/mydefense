import { expect, test } from 'bun:test'
import { repoImportFromEnv } from './config.ts'
import { FILES, githubStub } from './github-stub.ts'
import {
  RepoImportError,
  createRepoImporter,
  parseRepo,
} from './repo-import.ts'

const CONFIG = { org: 'wefaber', token: 'tok' }

test('parseRepo takes the org repo in any spelling and refuses other owners', () => {
  expect(parseRepo('eternum-docs', 'wefaber')).toBe('eternum-docs')
  expect(parseRepo('wefaber/eternum-docs', 'wefaber')).toBe('eternum-docs')
  expect(parseRepo('WeFaber/eternum-docs', 'wefaber')).toBe('eternum-docs')
  expect(
    parseRepo('https://github.com/wefaber/eternum-docs.git', 'wefaber'),
  ).toBe('eternum-docs')
  expect(() => parseRepo('otra/eternum-docs', 'wefaber')).toThrow(
    RepoImportError,
  )
  expect(() => parseRepo('wefaber/..', 'wefaber')).toThrow(RepoImportError)
  expect(() => parseRepo('', 'wefaber')).toThrow(RepoImportError)
  expect(() => parseRepo('a b', 'wefaber')).toThrow(RepoImportError)
})

test('only text files outside hidden folders and node_modules are listed', async () => {
  const calls: string[] = []
  const importer = createRepoImporter(
    CONFIG,
    githubStub(() => FILES, calls),
  )
  const all = await importer.tree({
    repo: 'eternum-docs',
    folder: '',
    ref: 'HEAD',
  })
  expect(all.entries.map((e) => e.path)).toEqual([
    'README.md',
    'docs/arquitectura.md',
    'docs/notas.txt',
  ])
  expect(calls[0]).toContain('/repos/wefaber/eternum-docs/git/trees/HEAD')

  const docs = await importer.tree({
    repo: 'eternum-docs',
    folder: 'docs',
    ref: 'main',
  })
  expect(docs.entries.map((e) => e.path)).toEqual([
    'docs/arquitectura.md',
    'docs/notas.txt',
  ])
  const bytes = await importer.read(
    { repo: 'eternum-docs', folder: '', ref: 'HEAD' },
    'docs/arquitectura.md',
  )
  expect(new TextDecoder().decode(bytes)).toBe('Arquitectura del sistema')
})

test('a missing repo, an empty folder and too many files are refused with a reason', async () => {
  const importer = createRepoImporter(
    CONFIG,
    githubStub(() => FILES),
  )
  await expect(
    importer.tree({ repo: 'nope', folder: '', ref: 'HEAD' }),
  ).rejects.toMatchObject({ status: 404 })
  await expect(
    importer.tree({ repo: 'eternum-docs', folder: 'otra', ref: 'HEAD' }),
  ).rejects.toMatchObject({ status: 404 })

  const many = Object.fromEntries(
    Array.from({ length: 501 }, (_, i) => [`d/n${i}.md`, `nota ${i}`]),
  )
  const big = createRepoImporter(
    CONFIG,
    githubStub(() => many),
  )
  await expect(
    big.tree({ repo: 'eternum-docs', folder: '', ref: 'HEAD' }),
  ).rejects.toThrow(/carpeta/)
})

test('the import token needs GitHub login settings', () => {
  const github = {
    org: 'wefaber',
    clientId: 'a',
    clientSecret: 'b',
    publicUrl: 'http://x',
  }
  expect(repoImportFromEnv({}, github)).toBeNull()
  expect(
    repoImportFromEnv({ MYDEFENSE_GITHUB_IMPORT_TOKEN: ' t ' }, github),
  ).toEqual({ org: 'wefaber', token: 't' })
  expect(() =>
    repoImportFromEnv({ MYDEFENSE_GITHUB_IMPORT_TOKEN: 't' }, null),
  ).toThrow(/GITHUB_IMPORT_TOKEN/)
})
