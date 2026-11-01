import { eq } from 'drizzle-orm'
import type { GithubLink } from '../github.ts'
import type { Db } from './connection.ts'
import * as t from './schema.ts'

type LinkRow = typeof t.githubLinks.$inferSelect

const toLink = (row: LinkRow): GithubLink => ({
  userId: row.userId,
  githubId: row.githubId,
  org: row.org,
  member: row.member,
  checkedAt: new Date(row.checkedAt),
})

export interface GithubLinks {
  findByGithubId(githubId: string): Promise<GithubLink | null>
  findByUser(userId: string): Promise<GithubLink | null>
  /** Creates or refreshes the link of a user. */
  save(link: GithubLink): Promise<void>
}

export function sqliteGithubLinks(db: Db): GithubLinks {
  return {
    async findByGithubId(githubId) {
      const row = db
        .select()
        .from(t.githubLinks)
        .where(eq(t.githubLinks.githubId, githubId))
        .get()
      return row ? toLink(row) : null
    },
    async findByUser(userId) {
      const row = db
        .select()
        .from(t.githubLinks)
        .where(eq(t.githubLinks.userId, userId))
        .get()
      return row ? toLink(row) : null
    },
    async save(link) {
      const values = {
        userId: link.userId,
        githubId: link.githubId,
        org: link.org,
        member: link.member,
        checkedAt: link.checkedAt.toISOString(),
      }
      db.insert(t.githubLinks)
        .values(values)
        .onConflictDoUpdate({ target: t.githubLinks.userId, set: values })
        .run()
    },
  }
}
