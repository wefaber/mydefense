import { join } from 'node:path'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import type { Db } from './connection.ts'

const MIGRATIONS = join(import.meta.dir, 'migrations')

export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: MIGRATIONS })
}

/** True once the migrations table exists and the catalog is queryable (what /ready reports). */
export function isReady(db: Db): boolean {
  try {
    db.$client.query('SELECT 1 FROM teams LIMIT 1').get()
    return true
  } catch {
    return false
  }
}
