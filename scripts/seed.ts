import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from '../server/config.ts'
import { openDb } from '../server/db/connection.ts'
import { runMigrations } from '../server/db/migrate.ts'
import { parseEternumData, seedEternum } from '../server/db/seed-eternum.ts'

const config = loadConfig(process.env)
const db = openDb(config.dbPath)
runMigrations(db)
const source = readFileSync(
  join(import.meta.dir, '..', 'seed', 'eternum', 'data.js'),
  'utf8',
)
const result = seedEternum(db, parseEternumData(source))
console.warn(
  result.created
    ? `Eternum seeded: ${JSON.stringify(result.counts)}`
    : 'Eternum already seeded.',
)
