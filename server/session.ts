export const SESSION_COOKIE = 'md_session'

/** One cookie from a raw `Cookie` header, for plain HTTP routes. GraphQL uses the cookie store. */
export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=') || undefined
  }
  return undefined
}

/** The session token from a raw `Cookie` header, for plain HTTP routes (uploads). GraphQL uses the cookie store. */
export function readSessionToken(request: Request): string | undefined {
  return readCookie(request, SESSION_COOKIE)
}
