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
  const body = (await res.json()) as {
    data?: T
    errors?: { message: string }[]
  }
  if (body.errors?.length || !body.data) {
    throw new Error(body.errors?.[0]?.message ?? 'Respuesta vacía.')
  }
  return body.data
}
