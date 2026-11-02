import { expect } from 'bun:test'

/** Test double for the GitHub endpoints the importer uses. */
export const FILES: Record<string, string> = {
  'README.md': '# Eternum docs\nHola',
  'docs/arquitectura.md': 'Arquitectura del sistema',
  'docs/notas.txt': 'notas',
  'docs/diagrama.png': 'binary',
  '.github/PULL_REQUEST_TEMPLATE.md': 'plantilla',
  'node_modules/x/README.md': 'dep',
  'vacio.md': '',
}

/** A stub of the two GitHub endpoints used: the tree of a repo and the raw content of a file. */
export function githubStub(
  files: () => Record<string, string>,
  calls: string[] = [],
) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url)
    calls.push(href)
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok')
    const { pathname, searchParams } = new URL(href)
    const now = files()
    if (pathname.includes('/git/trees/')) {
      if (pathname.includes('/nope/')) return new Response('', { status: 404 })
      expect(searchParams.get('recursive')).toBe('1')
      return Response.json({
        sha: `tree:${Bun.hash(JSON.stringify(now))}`,
        truncated: false,
        tree: [
          ...Object.entries(now).map(([path, text]) => ({
            path,
            type: 'blob',
            sha: `blob:${Bun.hash(text)}`,
            size: text.length,
          })),
          { path: 'docs', type: 'tree', sha: 'x' },
        ],
      })
    }
    const path = decodeURIComponent(pathname.split('/contents/')[1]!)
    return new Response(now[path] ?? '', { status: path in now ? 200 : 404 })
  }) as unknown as typeof fetch
}
