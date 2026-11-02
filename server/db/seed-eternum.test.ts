import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Catalog } from './catalog.ts'
import { openDb } from './connection.ts'
import { runMigrations } from './migrate.ts'
import {
  parseEternumData,
  seedEternum,
  seedEternumFromDisk,
} from './seed-eternum.ts'

const source = readFileSync(
  join(import.meta.dir, '..', '..', 'seed', 'eternum', 'data.js'),
  'utf8',
)

function seeded() {
  const db = openDb(':memory:')
  runMigrations(db)
  const result = seedEternum(db, parseEternumData(source))
  return { db, result, catalog: new Catalog(db) }
}

test('Eternum seed keeps the study tool counts', () => {
  const { result, catalog } = seeded()
  expect(result.counts).toMatchObject({
    identities: 4,
    sections: 14,
    points: 69,
    bank: 15,
  })
  const team = catalog.publicTeamBySlug('eternum')!
  expect(catalog.identities(team.id)).toHaveLength(4)
  expect(catalog.sections(team.id)).toHaveLength(14)
  expect(catalog.points(team.id)).toHaveLength(69)
  expect(catalog.resources(team.id, 'lesson')).toHaveLength(6)
  const byGroup = (g: 'point' | 'bank' | 'topic') =>
    catalog.questions(team.id, g, 100, 0).length
  expect(byGroup('bank')).toBe(15)
  expect(byGroup('topic')).toBe(12)
  expect(byGroup('point') + byGroup('bank') + byGroup('topic')).toBe(103)
})

test('every point has an owner and every question is approved', () => {
  const { catalog } = seeded()
  const team = catalog.publicTeamBySlug('eternum')!
  expect(catalog.points(team.id).every((p) => p.ownerId !== null)).toBe(true)
  expect(
    catalog
      .questions(team.id, null, 100, 0)
      .every((q) => q.status === 'approved'),
  ).toBe(true)
})

test('seeding twice does not duplicate', () => {
  const { db, result } = seeded()
  const again = seedEternum(db, parseEternumData(source))
  expect(again.created).toBe(false)
  expect(again.teamId).toBe(result.teamId)
  expect(new Catalog(db).publicTeams()).toHaveLength(1)
})

test('reads are scoped to the team id', () => {
  const { catalog } = seeded()
  expect(catalog.points('not-a-team')).toHaveLength(0)
  expect(catalog.questions('not-a-team', null, 100, 0)).toHaveLength(0)
  expect(catalog.identities('not-a-team')).toHaveLength(0)
})

test('a fresh database gets the Eternum team at boot, once', () => {
  const db = openDb(':memory:')
  runMigrations(db)
  expect(new Catalog(db).publicTeamBySlug('eternum')).toBeUndefined()
  expect(seedEternumFromDisk(db).created).toBe(true)
  expect(new Catalog(db).publicTeamBySlug('eternum')).not.toBeNull()
  expect(seedEternumFromDisk(db).created).toBe(false)
})
