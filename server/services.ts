import {
  createAccounts,
  createLimiter,
  createSecretBox,
  type Accounts,
  type Limiter,
} from '@wefaber/accounts'
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
}

/** Wires the domain services over one database. `files` is injectable so tests never touch the disk. */
export function buildServices(
  config: Pick<Config, 'filesDir' | 'keyFile'>,
  db: Db,
  files: FileStore = diskFiles(config.filesDir),
): Services {
  return {
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
