import { and, eq, isNull, lte } from 'drizzle-orm'
import type {
  AccountStore,
  AccountUser,
  SessionRecord,
} from '@wefaber/accounts'
import type { Db } from './connection.ts'
import * as t from './schema.ts'

type UserRow = typeof t.users.$inferSelect

const toUser = (row: UserRow): AccountUser => ({
  id: row.id,
  handle: row.handle,
  displayName: row.displayName,
  passwordHash: row.passwordHash,
  emailEnc: row.emailEnc,
  totpSecretEnc: row.totpSecretEnc,
  totpEnabled: row.totpEnabled,
  status: row.status,
  createdAt: new Date(row.createdAt),
  updatedAt: new Date(row.updatedAt),
})

const iso = (d: Date) => d.toISOString()

/** `@wefaber/accounts` store port over SQLite. Sessions and recovery codes are keyed by hash. */
export function sqliteAccountStore(db: Db): AccountStore {
  return {
    async findUserById(id) {
      const row = db.select().from(t.users).where(eq(t.users.id, id)).get()
      return row ? toUser(row) : null
    },
    async findUserByHandle(handle) {
      const row = db
        .select()
        .from(t.users)
        .where(eq(t.users.handle, handle))
        .get()
      return row ? toUser(row) : null
    },
    async insertUser(user) {
      // The unique index decides: no check-then-insert race.
      const res = db
        .insert(t.users)
        .values({
          id: user.id,
          handle: user.handle,
          displayName: user.displayName,
          passwordHash: user.passwordHash,
          emailEnc: user.emailEnc,
          totpSecretEnc: user.totpSecretEnc,
          totpEnabled: user.totpEnabled,
          status: user.status,
          createdAt: iso(user.createdAt),
          updatedAt: iso(user.updatedAt),
        })
        .onConflictDoNothing()
        .returning({ id: t.users.id })
        .all()
      return res.length > 0
    },
    async updateUser(id, patch) {
      const {
        createdAt: _ignored,
        updatedAt,
        ...rest
      } = patch as typeof patch & { createdAt?: Date }
      db.update(t.users)
        .set({ ...rest, ...(updatedAt ? { updatedAt: iso(updatedAt) } : {}) })
        .where(eq(t.users.id, id))
        .run()
    },
    async deleteUser(id) {
      db.delete(t.users).where(eq(t.users.id, id)).run()
    },

    async insertSession(s) {
      db.insert(t.sessions)
        .values({
          tokenHash: s.tokenHash,
          userId: s.userId,
          createdAt: iso(s.createdAt),
          expiresAt: iso(s.expiresAt),
          lastSeen: iso(s.lastSeen),
        })
        .run()
    },
    async findSession(tokenHash) {
      const row = db
        .select()
        .from(t.sessions)
        .where(eq(t.sessions.tokenHash, tokenHash))
        .get()
      if (!row) return null
      const session: SessionRecord = {
        tokenHash: row.tokenHash,
        userId: row.userId,
        createdAt: new Date(row.createdAt),
        expiresAt: new Date(row.expiresAt),
        lastSeen: new Date(row.lastSeen),
      }
      return session
    },
    async touchSession(tokenHash, lastSeen, expiresAt) {
      db.update(t.sessions)
        .set({ lastSeen: iso(lastSeen), expiresAt: iso(expiresAt) })
        .where(eq(t.sessions.tokenHash, tokenHash))
        .run()
    },
    async deleteSession(tokenHash) {
      db.delete(t.sessions).where(eq(t.sessions.tokenHash, tokenHash)).run()
    },
    async deleteSessionsOf(userId) {
      db.delete(t.sessions).where(eq(t.sessions.userId, userId)).run()
    },
    async deleteExpiredSessions(now) {
      db.delete(t.sessions)
        .where(lte(t.sessions.expiresAt, iso(now)))
        .run()
    },

    async replaceRecoveryCodes(userId, codeHashes) {
      db.transaction((tx) => {
        tx.delete(t.recoveryCodes)
          .where(eq(t.recoveryCodes.userId, userId))
          .run()
        for (const codeHash of codeHashes) {
          tx.insert(t.recoveryCodes)
            .values({ userId, codeHash, usedAt: null })
            .run()
        }
      })
    },
    async consumeRecoveryCode(userId, codeHash, usedAt) {
      const res = db
        .update(t.recoveryCodes)
        .set({ usedAt: iso(usedAt) })
        .where(
          and(
            eq(t.recoveryCodes.userId, userId),
            eq(t.recoveryCodes.codeHash, codeHash),
            isNull(t.recoveryCodes.usedAt),
          ),
        )
        .returning({ hash: t.recoveryCodes.codeHash })
        .all()
      return res.length > 0
    },
    async countRecoveryCodes(userId) {
      return db
        .select()
        .from(t.recoveryCodes)
        .where(
          and(
            eq(t.recoveryCodes.userId, userId),
            isNull(t.recoveryCodes.usedAt),
          ),
        )
        .all().length
    },
  }
}
