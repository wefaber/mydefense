export async function gql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch('/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok && res.headers.get('content-type')?.includes('json') !== true) {
    throw new Error(`No se pudo cargar (HTTP ${res.status}).`)
  }
  const body = (await res.json().catch(() => null)) as {
    data?: T
    errors?: { message: string; extensions?: { code?: string } }[]
  } | null
  if (!body) throw new Error(`Respuesta inválida (HTTP ${res.status}).`)
  if (body.errors?.length || !body.data) {
    const first = body.errors?.[0]
    // The stable code lets a screen offer the right next step (for instance, signing in with GitHub again).
    throw Object.assign(new Error(first?.message ?? 'Respuesta vacía.'), {
      code: first?.extensions?.code,
    })
  }
  return body.data
}
