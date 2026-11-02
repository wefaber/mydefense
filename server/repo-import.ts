import type { RepoImportConfig } from './config.ts'
import { MAX_FILES_PER_SOURCE } from './db/knowledge.ts'

const API = 'https://api.github.com'
const TIMEOUT_MS = 15_000
/** Text only: PDFs and DOCX in a repo are binary blobs better uploaded by hand. */
const TEXT_EXT = /\.(md|txt)$/i
const SKIP_DIR = /(^|\/)(\.[^/]+|node_modules)\//
/** A larger file is skipped: indexing keeps at most the first chunks of a file anyway. */
const FILE_MAX_BYTES = 2 * 1024 * 1024

export class RepoImportError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'RepoImportError'
    this.status = status
  }
}

export interface RepoSpec {
  /** `repo`, `<org>/repo` or a github.com URL of a repo of the configured org. */
  repo: string
  /** Only files under this folder. */
  path?: string
  /** Branch, tag or commit. The default branch when empty. */
  ref?: string
}

/** A spec after validation: the exact key of a source. */
export interface RepoTarget {
  repo: string
  folder: string
  ref: string
}

export interface RepoEntry {
  path: string
  /** Git blob sha: equal sha, equal content. */
  sha: string
  size: number
}

export interface RepoTree {
  /** Sha of the root tree at `ref`: equal sha, nothing changed anywhere in the repo. */
  treeSha: string
  /** The indexable text files under the folder, sorted by path. */
  entries: RepoEntry[]
}

export interface RepoImporter {
  readonly org: string
  tree(target: RepoTarget): Promise<RepoTree>
  read(target: RepoTarget, path: string): Promise<Uint8Array>
}

const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/
const REF = /^[A-Za-z0-9._/-]{1,100}$/

/** Accepts `repo`, `org/repo` or `https://github.com/org/repo[.git]`. The owner can only be the configured org. */
export function parseRepo(raw: string, org: string): string {
  const text = raw
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
  const parts = text.split('/').filter(Boolean)
  const [owner, name] = parts.length === 1 ? [org, parts[0]] : parts
  if (owner?.toLowerCase() !== org.toLowerCase()) {
    throw new RepoImportError(
      400,
      `Solo se pueden importar repos de la organización ${org}.`,
    )
  }
  if (!name || name === '.' || name === '..' || !REPO_NAME.test(name)) {
    throw new RepoImportError(400, 'El nombre del repo no es válido.')
  }
  return name
}

function cleanFolder(raw: string | undefined): string {
  const path = (raw ?? '').trim().replace(/^\/+|\/+$/g, '')
  if (path.split('/').some((p) => p === '..' || p === '.')) {
    throw new RepoImportError(400, 'La carpeta no es válida.')
  }
  return path
}

function cleanRef(raw: string | undefined): string {
  const ref = (raw ?? '').trim()
  if (!ref) return 'HEAD'
  if (!REF.test(ref) || ref.includes('..')) {
    throw new RepoImportError(400, 'La rama o etiqueta no es válida.')
  }
  return ref
}

/** Validates what the user typed into the key of a source. */
export function targetOf(spec: RepoSpec, org: string): RepoTarget {
  return {
    repo: parseRepo(spec.repo, org),
    folder: cleanFolder(spec.path),
    ref: cleanRef(spec.ref),
  }
}

const encodePath = (path: string) =>
  path.split('/').map(encodeURIComponent).join('/')

export function createRepoImporter(
  config: RepoImportConfig,
  fetchFn: typeof fetch = fetch,
): RepoImporter {
  const get = async (path: string, accept: string) => {
    try {
      return await fetchFn(`${API}${path}`, {
        headers: {
          authorization: `Bearer ${config.token}`,
          accept,
          'x-github-api-version': '2022-11-28',
          'user-agent': 'mydefense',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      throw new RepoImportError(502, 'No pudimos llegar a GitHub.')
    }
  }

  const failed = (res: Response, what: string) => {
    if (res.status === 404) {
      return new RepoImportError(
        404,
        `No encontramos ${what} en ${config.org}. Revisá el nombre, la rama y que el token de importación lo vea.`,
      )
    }
    if (res.status === 401 || res.status === 403) {
      return new RepoImportError(
        502,
        'GitHub rechazó el token de importación o llegamos al límite de pedidos.',
      )
    }
    return new RepoImportError(502, `GitHub respondió ${res.status}.`)
  }

  const base = (repo: string) =>
    `/repos/${encodeURIComponent(config.org)}/${encodeURIComponent(repo)}`

  return {
    org: config.org,

    async tree({ repo, folder, ref }) {
      const res = await get(
        `${base(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
        'application/vnd.github+json',
      )
      if (!res.ok) throw failed(res, `el repo ${repo}`)
      const body = (await res.json()) as {
        sha?: string
        truncated?: boolean
        tree?: { path: string; type: string; sha: string; size?: number }[]
      }
      if (!body.sha || body.truncated) {
        throw new RepoImportError(
          400,
          'El repo es demasiado grande para importarlo entero: elegí una carpeta.',
        )
      }
      const entries = (body.tree ?? [])
        .filter(
          (e) =>
            e.type === 'blob' &&
            TEXT_EXT.test(e.path) &&
            !SKIP_DIR.test(`/${e.path}`) &&
            (!folder || e.path.startsWith(`${folder}/`)) &&
            (e.size ?? 0) > 0 &&
            (e.size ?? 0) <= FILE_MAX_BYTES,
        )
        .map((e) => ({ path: e.path, sha: e.sha, size: e.size ?? 0 }))
        .toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      if (entries.length === 0) {
        throw new RepoImportError(
          404,
          'No hay archivos Markdown ni de texto para importar ahí.',
        )
      }
      if (entries.length > MAX_FILES_PER_SOURCE) {
        throw new RepoImportError(
          400,
          `Hay ${entries.length} archivos y una fuente admite hasta ${MAX_FILES_PER_SOURCE}. Elegí una carpeta más específica.`,
        )
      }
      return { treeSha: body.sha, entries }
    },

    async read({ repo, ref }, path) {
      const res = await get(
        `${base(repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
        'application/vnd.github.raw+json',
      )
      if (!res.ok) throw failed(res, path)
      return new Uint8Array(await res.arrayBuffer())
    },
  }
}
