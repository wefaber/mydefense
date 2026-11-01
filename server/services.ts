import {
  createAccounts,
  createLimiter,
  createSecretBox,
  type Accounts,
  type Limiter,
} from '@wefaber/accounts'
import type { Llm } from './ai/llm.ts'
import type { VoiceConfig } from './ai/voice.ts'
import type { Config } from './config.ts'
import { sqliteAccountStore } from './db/account-store.ts'
import { Catalog } from './db/catalog.ts'
import type { Db } from './db/connection.ts'
import { Workspace, type FileStore } from './db/workspace.ts'
import { diskFiles } from './files.ts'

export interface Services {
  catalog: Catalog
  workspace: Workspace
  accounts: Accounts
  limiter: Limiter
  /** Optional providers: without them grading and voice are off and the practice stays self-graded. */
  ai: Ai
}

export interface Ai {
  llm: Llm | null
  voice: VoiceConfig | null
}

/** Wires the domain services over one database. `files` and `ai` are injectable so tests touch neither disk nor network. */
export function buildServices(
  config: Pick<Config, 'filesDir' | 'keyFile'>,
  db: Db,
  files: FileStore = diskFiles(config.filesDir),
  ai: Ai = { llm: null, voice: null },
): Services {
  return {
    ai,
    catalog: new Catalog(db),
    workspace: new Workspace(db, files),
    accounts: createAccounts({
      store: sqliteAccountStore(db),
      box: createSecretBox({ keyFile: config.keyFile }),
      issuer: 'MyDefense',
      reservedHandles: ['mydefense'],
      commonPasswords: ['mydefense', 'eternum'],
    }),
    limiter: createLimiter(),
  }
}
