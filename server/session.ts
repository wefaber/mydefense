export const SESSION_COOKIE = 'md_session'

/** The session token from a raw `Cookie` header, for plain HTTP routes (uploads). GraphQL uses the cookie store. */
export function readSessionToken(request: Request): string | undefined {
  const header = request.headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === SESSION_COOKIE) return rest.join('=') || undefined
  }
  return undefined
}
