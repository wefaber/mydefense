import { expect, test } from 'bun:test'
import { githubFromEnv } from './config.ts'
import { REVERIFY_MS, teamAccess, type GithubLink } from './github.ts'

const NOW = new Date('2026-11-01T12:00:00Z')
const link = (over: Partial<GithubLink> = {}): GithubLink => ({
  userId: 'u1',
  githubId: '1',
  org: 'wefaber',
  member: true,
  checkedAt: NOW,
  ...over,
})

test('team creation: only a fresh membership of the configured org', () => {
  expect(teamAccess(null, 'wefaber', NOW)).toBe('no-link')
  expect(teamAccess(link({ member: false }), 'wefaber', NOW)).toBe('not-member')
  expect(teamAccess(link(), 'wefaber', NOW)).toBe('ok')
  expect(teamAccess(link({ org: 'otra' }), 'wefaber', NOW)).toBe('reverify')

  const almost = new Date(NOW.getTime() + REVERIFY_MS - 1)
  expect(teamAccess(link(), 'wefaber', almost)).toBe('ok')
  const stale = new Date(NOW.getTime() + REVERIFY_MS)
  expect(teamAccess(link(), 'wefaber', stale)).toBe('reverify')
})

test('GitHub login is off unless all four settings are present', () => {
  expect(githubFromEnv({})).toBeNull()
  expect(() =>
    githubFromEnv({
      MYDEFENSE_GITHUB_ORG: 'wefaber',
      MYDEFENSE_GITHUB_CLIENT_ID: 'x',
    }),
  ).toThrow(/MYDEFENSE_GITHUB_CLIENT_SECRET/)
  expect(
    githubFromEnv({
      MYDEFENSE_GITHUB_ORG: ' wefaber ',
      MYDEFENSE_GITHUB_CLIENT_ID: 'id',
      MYDEFENSE_GITHUB_CLIENT_SECRET: 'secret',
      MYDEFENSE_PUBLIC_URL: 'https://mydefense.example/',
    }),
  ).toEqual({
    org: 'wefaber',
    clientId: 'id',
    clientSecret: 'secret',
    publicUrl: 'https://mydefense.example',
  })
})
