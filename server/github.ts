import { DAY_MS } from '@wefaber/accounts'
import { GitHub } from 'arctic'
import type { GitHubConfig } from './config.ts'

const API = 'https://api.github.com'
const TIMEOUT_MS = 10_000

/** A GitHub sign-in linked to a user. Never the token, never the email. */
export interface GithubLink {
  userId: string
  githubId: string
  org: string
  member: boolean
  checkedAt: Date
}

/**
 * Team creation needs a membership read within this window. The OAuth token is not kept, so the check cannot run on
 * its own: it runs again at every GitHub sign-in, and a stale result means "sign in with GitHub again".
 */
export const REVERIFY_MS = DAY_MS

export interface GitHubProfile {
  id: string
  login: string
  member: boolean
}

export class GitHubError extends Error {}

export interface GitHubLogin {
  readonly org: string
  /** Where the browser goes to approve the app. `state` must come back unchanged. */
  authorizeUrl(state: string): string
  /**
   * Trades the code for a token, reads the user and the org membership with it, and drops the token. Throws
   * `GitHubError` on any failure; nothing is half-applied.
   */
  signIn(code: string): Promise<GitHubProfile>
}

async function get(token: string, path: string): Promise<Response> {
  return fetch(`${API}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'mydefense',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
}

/** A 404 means "not a member" (or not visible to this token); any other failure is not an answer and is not stored. */
async function isActiveMember(token: string, org: string): Promise<boolean> {
  const res = await get(
    token,
    `/user/memberships/orgs/${encodeURIComponent(org)}`,
  )
  if (res.status === 404) return false
  if (!res.ok)
    throw new GitHubError(`GitHub respondió ${res.status} al leer la membresía`)
  const body = (await res.json()) as { state?: string }
  return body.state === 'active'
}

/** Only the org name is configured; `read:org` is the one scope asked for, and no email is requested. */
export function createGitHubLogin(config: GitHubConfig): GitHubLogin {
  const oauth = new GitHub(
    config.clientId,
    config.clientSecret,
    `${config.publicUrl}/auth/github/callback`,
  )
  return {
    org: config.org,
    authorizeUrl: (state) =>
      oauth.createAuthorizationURL(state, ['read:org']).toString(),
    async signIn(code) {
      let token: string
      try {
        token = (await oauth.validateAuthorizationCode(code)).accessToken()
      } catch {
        throw new GitHubError('GitHub no confirmó el ingreso')
      }
      const res = await get(token, '/user')
      if (!res.ok)
        throw new GitHubError(
          `GitHub respondió ${res.status} al leer el usuario`,
        )
      const user = (await res.json()) as { id: number; login: string }
      const member = await isActiveMember(token, config.org)
      token = ''
      return { id: String(user.id), login: user.login, member }
    },
  }
}

export type TeamAccess = 'ok' | 'no-link' | 'not-member' | 'reverify'

/** Who may create a team right now. Pure: the clock is passed in. */
export function teamAccess(
  link: GithubLink | null,
  org: string,
  now: Date,
): TeamAccess {
  if (!link) return 'no-link'
  if (link.org !== org) return 'reverify'
  if (!link.member) return 'not-member'
  if (now.getTime() - link.checkedAt.getTime() >= REVERIFY_MS) return 'reverify'
  return 'ok'
}
