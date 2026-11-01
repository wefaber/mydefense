import {
  createAccounts,
  createLimiter,
  createSecretBox,
  type Accounts,
  type AccountStore,
  type Limiter,
} from '@wefaber/accounts'
import type { Evidence } from './ai/evidence.ts'
import type { Llm } from './ai/llm.ts'
import type { VoiceConfig } from './ai/voice.ts'
import type { Config } from './config.ts'
import { sqliteAccountStore } from './db/account-store.ts'
import { Catalog } from './db/catalog.ts'
import type { Db } from './db/connection.ts'
import { sqliteGithubLinks, type GithubLinks } from './db/github-store.ts'
import { createGitHubLogin, type GitHubLogin } from './github.ts'
import { Workspace, type FileStore } from './db/workspace.ts'
import { diskFiles } from './files.ts'

export interface Services {
  catalog: Catalog
  workspace: Workspace
  accounts: Accounts
  accountStore: AccountStore
  limiter: Limiter
  /** Null when GitHub login is not configured: no GitHub sign-in, and no one can create a team. */
  github: GitHubLogin | null
  githubLinks: GithubLinks
  /** Optional providers: without them grading and voice are off and the practice stays self-graded. */
  ai: Ai
}

export interface Ai {
  llm: Llm | null
  voice: VoiceConfig | null
  /** The Board's evidence API: lets grading check answers against the project's own documents. */
  evidence: Evidence | null
}

/**
 * Wires the domain services over one database. `files` and `ai` are injectable so tests touch neither disk nor
 * network. GitHub is reached through the global `fetch`, which tests stub.
 */
export function buildServices(
  config: Pick<Config, 'filesDir' | 'keyFile'> &
    Partial<Pick<Config, 'github'>>,
  db: Db,
  files: FileStore = diskFiles(config.filesDir),
  ai: Ai = { llm: null, voice: null, evidence: null },
): Services {
  const accountStore = sqliteAccountStore(db)
  return {
    ai,
    catalog: new Catalog(db),
    workspace: new Workspace(db, files),
    accountStore,
    accounts: createAccounts({
      store: accountStore,
      box: createSecretBox({ keyFile: config.keyFile }),
      issuer: 'MyDefense',
      reservedHandles: ['mydefense'],
      commonPasswords: ['mydefense', 'eternum'],
    }),
    limiter: createLimiter(),
    github: config.github ? createGitHubLogin(config.github) : null,
    githubLinks: sqliteGithubLinks(db),
  }
}
