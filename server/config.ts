import { join, resolve } from 'node:path'

export interface Config {
  port: number
  host: string
  dbPath: string
  distDir: string | null
  production: boolean
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const root = resolve(import.meta.dir, '..')
  const production = env.NODE_ENV === 'production'
  return {
    port: Number(env.MYDEFENSE_PORT ?? 5191),
    host: '127.0.0.1',
    dbPath: env.MYDEFENSE_DB ?? join(root, 'data', 'mydefense.db'),
    distDir:
      production || env.MYDEFENSE_DIST
        ? resolve(env.MYDEFENSE_DIST ?? join(root, 'dist'))
        : null,
    production,
  }
}
