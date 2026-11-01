import { existsSync, statSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import { Elysia } from 'elysia'
import { createYoga } from 'graphql-yoga'
import type { Config } from './config.ts'
import type { Catalog } from './db/catalog.ts'
import type { Db } from './db/connection.ts'
import { isReady } from './db/migrate.ts'
import { limitsPlugin } from './graphql/limits.ts'
import { buildSchema, type Context } from './graphql/schema.ts'

export interface Deps {
  config: Pick<Config, 'production' | 'distDir'>
  db: Db
  catalog: Catalog
}

/** File inside `dist`, or null. Rejects anything that escapes the directory. */
function resolveStatic(dist: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const full = normalize(join(dist, decoded))
  if (full !== dist && !full.startsWith(dist + sep)) return null
  return existsSync(full) && statSync(full).isFile() ? full : null
}

export function createApp({ config, db, catalog }: Deps) {
  const yoga = createYoga<Record<string, never>, Context>({
    schema: buildSchema(),
    context: () => ({ catalog }),
    graphqlEndpoint: '/graphql',
    graphiql: !config.production,
    landingPage: false,
    maskedErrors: true,
    logging: config.production ? 'error' : 'warn',
    plugins: [limitsPlugin()],
  })

  const app = new Elysia()
    .get('/health', () => ({ status: 'ok' }))
    .get('/ready', ({ set }) => {
      if (isReady(db)) return { status: 'ready' }
      set.status = 503
      return { status: 'not-ready' }
    })
    .all('/graphql', ({ request }) => yoga.fetch(request), { parse: 'none' })

  const dist = config.distDir
  if (!dist) return app

  return app.get('/*', ({ request, set }) => {
    const { pathname } = new URL(request.url)
    const file = resolveStatic(dist, pathname)
    if (file) {
      const immutable = pathname.startsWith('/assets/')
      return new Response(Bun.file(file), {
        headers: {
          'cache-control': immutable
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        },
      })
    }
    // A missing file with an extension is a real 404; any other path is a client route.
    if (/\.[a-z0-9]+$/i.test(pathname)) {
      set.status = 404
      return { error: { code: 'NOT_FOUND', message: 'Not found.' } }
    }
    return new Response(Bun.file(join(dist, 'index.html')), {
      headers: { 'cache-control': 'no-cache' },
    })
  })
}
