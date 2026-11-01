import { join, resolve } from 'node:path'

export interface GitHubConfig {
  /** The organization whose members may create teams. */
  org: string
  clientId: string
  clientSecret: string
  /** Public origin of the site, without a trailing slash: the callback is `<publicUrl>/auth/github/callback`. */
  publicUrl: string
}

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
  /** GitHub login and org-gated team creation. Null when unset: no GitHub login, and nobody can create a team. */
  github: GitHubConfig | null
}

const GITHUB_KEYS = [
  'MYDEFENSE_GITHUB_ORG',
  'MYDEFENSE_GITHUB_CLIENT_ID',
  'MYDEFENSE_GITHUB_CLIENT_SECRET',
  'MYDEFENSE_PUBLIC_URL',
] as const

/** All four or none: a half-set GitHub login would fail open or closed in a confusing way, so it fails at boot. */
export function githubFromEnv(
  env: Record<string, string | undefined>,
): GitHubConfig | null {
  const set = GITHUB_KEYS.filter((key) => env[key]?.trim())
  if (set.length === 0) return null
  if (set.length !== GITHUB_KEYS.length) {
    throw new Error(
      `GitHub login needs ${GITHUB_KEYS.join(', ')} together (missing: ${GITHUB_KEYS.filter((k) => !set.includes(k)).join(', ')}).`,
    )
  }
  return {
    org: env.MYDEFENSE_GITHUB_ORG!.trim(),
    clientId: env.MYDEFENSE_GITHUB_CLIENT_ID!.trim(),
    clientSecret: env.MYDEFENSE_GITHUB_CLIENT_SECRET!.trim(),
    publicUrl: env.MYDEFENSE_PUBLIC_URL!.trim().replace(/\/+$/, ''),
  }
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
    github: githubFromEnv(env),
  }
}
