import { SESSION_COOKIE } from './session.ts'
import type { Services } from './services.ts'

/** The config the tests run with. The org is a test name, never the real one. */
export const GITHUB_TEST_CONFIG = {
  org: 'wefaber',
  clientId: 'test-client',
  clientSecret: 'test-secret',
  publicUrl: 'http://localhost:5190',
}

/**
 * A signed-in account with a GitHub link, written straight to the database: no GitHub call is made. The sign-in flow
 * itself is covered in auth.test.ts. Returns the Cookie header to send with requests.
 */
export async function githubCookie(
  services: Services,
  handle = 'practicante',
): Promise<string> {
  const res = await services.accounts.register({
    handle,
    displayName: handle,
    password: 'a long enough passphrase 1',
  })
  if (!res.ok) throw new Error(res.error)
  await services.githubLinks.save({
    userId: res.value.user.id,
    githubId: `gh-${handle}`,
    org: GITHUB_TEST_CONFIG.org,
    member: true,
    checkedAt: new Date(),
  })
  const session = await services.accounts.startSession(res.value.user.id)
  return `${SESSION_COOKIE}=${session.token}`
}
