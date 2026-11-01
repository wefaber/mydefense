/**
 * Repo checks (house rule "Isolation below the API"): SQL access lives in `server/db/` only.
 * Everything else reaches data through the Catalog. Seed/migrate scripts go through `server/db/` helpers too.
 */
import { Glob } from 'bun'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const FORBIDDEN = /from ['"](bun:sqlite|drizzle-orm[^'"]*|better-sqlite3)['"]/
const ALLOWED = (file: string) =>
  file.startsWith('server/db/') || file.endsWith('.test.ts')

const problems: string[] = []
for (const pattern of [
  'server/**/*.ts',
  'scripts/**/*.ts',
  'src/**/*.{ts,tsx}',
  'shared/**/*.ts',
]) {
  for (const file of new Glob(pattern).scanSync({ cwd: root })) {
    const path = file.replaceAll('\\', '/')
    if (ALLOWED(path)) continue
    const text = await Bun.file(join(root, file)).text()
    if (FORBIDDEN.test(text))
      problems.push(`${path}: SQL access outside server/db/`)
  }
}

for (const file of new Glob('src/**/*.{ts,tsx}').scanSync({ cwd: root })) {
  const text = await Bun.file(join(root, file)).text()
  if (/from ['"][./]*\/?server\//.test(text)) {
    problems.push(
      `${file.replaceAll('\\', '/')}: the SPA must not import from server/`,
    )
  }
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.warn('repo checks ok')
