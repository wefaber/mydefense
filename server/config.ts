import { join, resolve } from 'node:path'

export interface Config {
  port: number
  host: string
  dbPath: string
  /** Uploaded materials. Next to the database by default so one directory holds all state. */
  filesDir: string
  distDir: string | null
  production: boolean
  /** Key file for `@wefaber/accounts` encryption at rest. Unused until email or 2FA are offered. */
  keyFile: string | undefined
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const root = resolve(import.meta.dir, '..')
  const production = env.NODE_ENV === 'production'
  const dbPath = env.MYDEFENSE_DB ?? join(root, 'data', 'mydefense.db')
  return {
    port: Number(env.MYDEFENSE_PORT ?? 5191),
    host: '127.0.0.1',
    dbPath,
    filesDir: resolve(env.MYDEFENSE_FILES ?? join(dbPath, '..', 'files')),
    distDir:
      production || env.MYDEFENSE_DIST
        ? resolve(env.MYDEFENSE_DIST ?? join(root, 'dist'))
        : null,
    production,
    keyFile: env.MYDEFENSE_KEY_FILE,
  }
}
