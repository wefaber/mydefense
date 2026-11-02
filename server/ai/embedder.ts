import { EmbedderClient } from '@wefaber/embed'

const TIMEOUT_MS = 20_000
const BATCH = 8

/** EmbeddingGemma 2 prompt formats (as in eternum-board): documents carry their title, queries a task line. */
const QUERY_PREFIX = 'task: search result | query: '
const docPrefix = (title: string) => `title: ${title} | text: `

/**
 * The house embedder (`@wefaber/embed`): 768-dimension, L2-normalised vectors, so similarity is a dot product.
 * Calls throw `EmbedderUnavailableError` / `EmbedderResponseError`; callers degrade to lexical search.
 */
export interface Embedder {
  readonly model: string
  /** One vector per item, same order. */
  docs(items: { title: string; text: string }[]): Promise<Float32Array[]>
  query(text: string): Promise<Float32Array>
}

export interface EmbedderConfig {
  /** Full embeddings endpoint, e.g. `http://127.0.0.1:8891/v1/embeddings`. */
  baseUrl: string
  model?: string
}

export function createEmbedder(
  config: EmbedderConfig,
  fetchFn: typeof fetch = fetch,
): Embedder {
  const client = new EmbedderClient({
    baseUrl: config.baseUrl,
    model: config.model,
    fetch: ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      fetchFn(input, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })) as typeof fetch,
  })
  return {
    model: client.model,
    async docs(items) {
      const vectors = await client.embedMany(
        items.map((i) => docPrefix(i.title) + i.text),
        { batchSize: BATCH },
      )
      return vectors.map((v) => Float32Array.from(v))
    },
    async query(text) {
      return Float32Array.from(await client.embed(QUERY_PREFIX + text))
    },
  }
}

/** `MYDEFENSE_EMBED_URL` (+ optional `MYDEFENSE_EMBED_MODEL`). Unset: indexing and search stay lexical. */
export function embedderFromEnv(
  env: Record<string, string | undefined>,
): Embedder | null {
  const baseUrl = env.MYDEFENSE_EMBED_URL?.trim()
  if (!baseUrl) return null
  return createEmbedder({
    baseUrl,
    model: env.MYDEFENSE_EMBED_MODEL?.trim() || undefined,
  })
}
