import { existsSync, statSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import { useCookies as cookiesPlugin } from '@whatwg-node/server-plugin-cookies'
import { Elysia } from 'elysia'
import { createYoga } from 'graphql-yoga'
import { MATERIAL_MAX_BYTES } from '../shared/types.ts'
import type { Config } from './config.ts'
import type { Db } from './db/connection.ts'
import { isReady } from './db/migrate.ts'
import { AccessError } from './db/workspace.ts'
import { teamAccess } from './github.ts'
import { finishGitHub, startGitHub } from './github-login.ts'
import { limitsPlugin } from './graphql/limits.ts'
import { buildSchema, type Context } from './graphql/schema.ts'
import { syncRepo } from './knowledge.ts'
import { RepoImportError } from './repo-import.ts'
import type { Services } from './services.ts'
import { SESSION_COOKIE, readSessionToken } from './session.ts'

export interface Deps {
  config: Pick<Config, 'production' | 'distDir'>
  db: Db
  services: Services
}

const error = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

const text = (v: unknown) => (typeof v === 'string' ? v : undefined)

const IMPORT_LIMIT = { max: 10, windowMs: 600_000 }

const STATUS: Record<AccessError['code'], number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  INVALID: 400,
  CONFLICT: 409,
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

/**
 * Cross-site writes: a browser always sends `Origin` on a cross-origin POST. If it names another host than the one
 * that was asked, refuse. (SameSite=Lax on the cookie is the first line; this is the second.)
 */
function crossSite(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return false
  const host =
    request.headers.get('x-forwarded-host') ??
    request.headers.get('host') ??
    new URL(request.url).host
  try {
    return new URL(origin).host !== host
  } catch {
    return true
  }
}

export function createApp({ config, db, services }: Deps) {
  const yoga = createYoga<{ request: Request }, Context>({
    schema: buildSchema(),
    context: async ({ request }) => {
      const token = (await request.cookieStore?.get(SESSION_COOKIE))?.value
      return {
        ...services,
        request,
        viewer: await services.accounts.sessionUser(token),
        secureCookie: config.production,
      }
    },
    graphqlEndpoint: '/graphql',
    graphiql: !config.production,
    landingPage: false,
    cors: false,
    maskedErrors: true,
    logging: config.production ? 'error' : 'warn',
    plugins: [cookiesPlugin(), limitsPlugin()],
  })

  const app = new Elysia()
    .onBeforeHandle(({ request }) => {
      if (
        request.method !== 'GET' &&
        request.method !== 'HEAD' &&
        crossSite(request)
      ) {
        return error(403, 'CROSS_SITE', 'Pedido de otro sitio.')
      }
    })
    .get('/health', () => ({ status: 'ok' }))
    .get('/ready', ({ set }) => {
      if (isReady(db)) return { status: 'ready' }
      set.status = 503
      return { status: 'not-ready' }
    })
    .all('/graphql', ({ request }) => yoga.fetch(request), { parse: 'none' })
    .get('/auth/github/start', ({ request }) =>
      startGitHub(services, request, config.production),
    )
    .get('/auth/github/callback', ({ request }) =>
      finishGitHub(services, request, config.production),
    )
    .post(
      '/api/teams/:slug/materials',
      async ({ request, params }) => {
        const { accounts, workspace } = services
        const viewer = await accounts.sessionUser(readSessionToken(request))
        if (!viewer) {
          return error(401, 'UNAUTHENTICATED', 'Ingresá para subir archivos.')
        }
        const length = Number(request.headers.get('content-length') ?? 0)
        if (length > MATERIAL_MAX_BYTES + 1024 * 1024) {
          return error(413, 'INVALID', 'El archivo pesa más de 10 MB.')
        }
        const team = workspace.visibleTeamBySlug(params.slug, viewer.id)
        if (!team) return error(404, 'NOT_FOUND', 'No encontramos ese equipo.')
        try {
          const form = await request.formData()
          const file = form.get('file')
          if (!(file instanceof File)) {
            return error(400, 'INVALID', 'Falta el archivo.')
          }
          const saved = await workspace.addMaterial(viewer.id, team.id, {
            name: file.name,
            bytes: new Uint8Array(await file.arrayBuffer()),
          })
          return Response.json({ material: saved }, { status: 201 })
        } catch (e) {
          if (e instanceof AccessError) {
            return error(STATUS[e.code], e.code, e.message)
          }
          throw e
        }
      },
      { parse: 'none' },
    )
    .post(
      '/api/teams/:slug/materials/import',
      async ({ request, params }) => {
        const { accounts, workspace, repoImport, github, githubLinks } =
          services
        const viewer = await accounts.sessionUser(readSessionToken(request))
        if (!viewer) {
          return error(401, 'UNAUTHENTICATED', 'Ingresá para importar.')
        }
        if (!repoImport || !github) {
          return error(
            503,
            'UNAVAILABLE',
            'La importación desde GitHub no está activa en este servidor.',
          )
        }
        // The token reads private repos of the org: only fresh members of that org may spend it.
        const link = await githubLinks.findByUser(viewer.id)
        if (teamAccess(link, github.org, new Date()) !== 'ok') {
          return error(
            403,
            'FORBIDDEN',
            `Importar es para miembros de la organización ${github.org}: entrá con GitHub para confirmarlo.`,
          )
        }
        if (!services.limiter.take(`import:${viewer.id}`, IMPORT_LIMIT).ok) {
          return error(
            429,
            'RATE_LIMITED',
            'Demasiados intentos. Probá de nuevo en un rato.',
          )
        }
        const team = workspace.visibleTeamBySlug(params.slug, viewer.id)
        if (!team) return error(404, 'NOT_FOUND', 'No encontramos ese equipo.')
        let spec: { repo?: unknown; path?: unknown; ref?: unknown }
        try {
          spec = await request.json()
        } catch {
          return error(400, 'INVALID', 'Pedido mal formado.')
        }
        if (!text(spec?.repo)?.trim()) {
          return error(400, 'INVALID', 'Falta el repo.')
        }
        try {
          const result = await syncRepo(
            {
              knowledge: services.knowledge,
              importer: repoImport,
              embedder: services.ai.embedder ?? null,
            },
            viewer.id,
            team.id,
            {
              repo: text(spec.repo)!,
              path: text(spec.path),
              ref: text(spec.ref),
            },
          )
          return Response.json({ import: result }, { status: 201 })
        } catch (e) {
          if (e instanceof AccessError) {
            return error(STATUS[e.code], e.code, e.message)
          }
          if (e instanceof RepoImportError) {
            return error(
              e.status,
              e.status === 502 ? 'UPSTREAM' : 'INVALID',
              e.message,
            )
          }
          throw e
        }
      },
      { parse: 'none' },
    )

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
