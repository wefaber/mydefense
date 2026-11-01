import { clientKey, type Accounts, type AccountUser } from '@wefaber/accounts'
import { generateState } from 'arctic'
import { timingSafeEqual } from 'node:crypto'
import { GitHubError, type GitHubProfile } from './github.ts'
import type { Services } from './services.ts'
import { SESSION_COOKIE, readCookie } from './session.ts'

export const OAUTH_COOKIE = 'md_oauth'
const OAUTH_MAX_AGE_S = 600
const LIMIT = { max: 30, windowMs: 600_000 }
const HANDLE_TRIES = 5
const AFTER_LOGIN = '/cuenta/equipos'
const FAILED = '/cuenta/entrar?error=github'

/** One `Set-Cookie` line: HttpOnly, SameSite Lax (the callback is a top-level navigation from GitHub). */
function cookieLine(
  name: string,
  value: string,
  opts: { path: string; maxAge?: number; expires?: Date },
  secure: boolean,
): string {
  const parts = [
    `${name}=${value}`,
    `Path=${opts.path}`,
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`)
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`)
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

const clearOauth = (secure: boolean) =>
  cookieLine(OAUTH_COOKIE, '', { path: '/auth/github', maxAge: 0 }, secure)

const redirect = (location: string, cookies: string[] = []) => {
  const headers = new Headers({ location })
  for (const line of cookies) headers.append('set-cookie', line)
  return new Response(null, { status: 302, headers })
}

const tooMany = () =>
  Response.json(
    {
      error: {
        code: 'RATE_LIMITED',
        message: 'Demasiados intentos. Probá de nuevo en un rato.',
      },
    },
    { status: 429 },
  )

/** Constant-time string compare; unequal lengths are a plain mismatch. */
function same(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const randomSuffix = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) =>
    (b % 36).toString(36),
  ).join('')

/**
 * A new account for a GitHub login, without a password. The handle is the login when it is free and valid; otherwise
 * the login with a random suffix. Never matched to an existing password account: that would be a takeover by name.
 */
async function newGitHubUser(
  accounts: Accounts,
  login: string,
): Promise<AccountUser> {
  const base = login.toLowerCase()
  for (let attempt = 0; attempt < HANDLE_TRIES; attempt++) {
    const handle =
      attempt === 0 ? base : `${base.slice(0, 21)}-${randomSuffix()}`
    const res = await accounts.register({ handle, displayName: login })
    if (res.ok) return res.value.user
  }
  throw new Error('no free handle for a GitHub sign-in')
}

/** Finds the account behind a GitHub id or makes one, then records this sign-in's membership. Null when suspended. */
export async function signInWithGitHub(
  services: Services,
  profile: GitHubProfile,
  now: Date,
): Promise<AccountUser | null> {
  const github = services.github
  if (!github) return null
  const link = await services.githubLinks.findByGithubId(profile.id)
  let user = link ? await services.accountStore.findUserById(link.userId) : null
  user ??= await newGitHubUser(services.accounts, profile.login)
  if (user.status !== 'active') return null
  await services.githubLinks.save({
    userId: user.id,
    githubId: profile.id,
    org: github.org,
    member: profile.member,
    checkedAt: now,
  })
  return user
}

/** `GET /auth/github/start`: a fresh state, kept in a short-lived cookie, then the browser goes to GitHub. */
export function startGitHub(
  services: Services,
  request: Request,
  secure: boolean,
): Response {
  if (!services.github) {
    return Response.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'El ingreso con GitHub no está activo.',
        },
      },
      { status: 404 },
    )
  }
  const key = `github:ip:${clientKey(request, null)}`
  if (!services.limiter.take(key, LIMIT).ok) return tooMany()

  const state = generateState()
  return redirect(services.github.authorizeUrl(state), [
    cookieLine(
      OAUTH_COOKIE,
      state,
      { path: '/auth/github', maxAge: OAUTH_MAX_AGE_S },
      secure,
    ),
  ])
}

/**
 * `GET /auth/github/callback`: checks the state, exchanges the code, signs the user in. Every failure goes back to the
 * sign-in page with `?error=github`, and no session is set.
 */
export async function finishGitHub(
  services: Services,
  request: Request,
  secure: boolean,
  now = new Date(),
): Promise<Response> {
  const fail = () => redirect(FAILED, [clearOauth(secure)])
  const github = services.github
  if (!github) return fail()

  const key = `github:ip:${clientKey(request, null)}`
  if (!services.limiter.take(key, LIMIT).ok) return tooMany()

  const url = new URL(request.url)
  const expected = readCookie(request, OAUTH_COOKIE)
  const state = url.searchParams.get('state')
  if (!expected || !state || !same(expected, state)) return fail()

  const code = url.searchParams.get('code')
  if (!code || url.searchParams.has('error')) return fail()

  let profile: GitHubProfile
  try {
    profile = await github.signIn(code)
  } catch (e) {
    if (e instanceof GitHubError) return fail()
    throw e
  }

  const user = await signInWithGitHub(services, profile, now)
  if (!user) return fail()
  const session = await services.accounts.startSession(user.id, now)
  return redirect(AFTER_LOGIN, [
    clearOauth(secure),
    cookieLine(
      SESSION_COOKIE,
      session.token,
      { path: '/', expires: session.expiresAt },
      secure,
    ),
  ])
}
