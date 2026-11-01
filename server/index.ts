import { evidenceFromEnv } from './ai/evidence.ts'
import { llmFromEnv } from './ai/llm.ts'
import { voiceFromEnv } from './ai/voice.ts'
import { createApp } from './app.ts'
import { diskFiles } from './files.ts'
import { loadConfig } from './config.ts'
import { openDb } from './db/connection.ts'
import { runMigrations } from './db/migrate.ts'
import { buildServices } from './services.ts'

const config = loadConfig(process.env)
const db = openDb(config.dbPath)
runMigrations(db)

const ai = {
  llm: llmFromEnv(process.env),
  voice: voiceFromEnv(process.env),
  evidence: evidenceFromEnv(process.env),
}
const services = buildServices(config, db, diskFiles(config.filesDir), ai)
const app = createApp({ config, db, services })
app.listen({ hostname: config.host, port: config.port })
console.warn(`mydefense listening on http://${config.host}:${config.port}`)
