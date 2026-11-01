import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { openDb } from './db/connection.ts'
import { runMigrations } from './db/migrate.ts'
import { buildServices } from './services.ts'

const config = loadConfig(process.env)
const db = openDb(config.dbPath)
runMigrations(db)

const app = createApp({ config, db, services: buildServices(config, db) })
app.listen({ hostname: config.host, port: config.port })
console.warn(`mydefense listening on http://${config.host}:${config.port}`)
