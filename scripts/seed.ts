import { loadConfig } from '../server/config.ts'
import { openDb } from '../server/db/connection.ts'
import { runMigrations } from '../server/db/migrate.ts'
import { seedEternumFromDisk } from '../server/db/seed-eternum.ts'

const config = loadConfig(process.env)
const db = openDb(config.dbPath)
runMigrations(db)
const result = seedEternumFromDisk(db)
console.warn(
  result.created
    ? `Eternum seeded: ${JSON.stringify(result.counts)}`
    : 'Eternum already seeded.',
)
