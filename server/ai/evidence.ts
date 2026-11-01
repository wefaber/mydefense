/**
 * Evidence from the Board. MyDefense never reads the Board's files or index: it asks the Board's API, so the Board can
 * become public for other teams without MyDefense knowing how it indexes. The contract is in `docs/adr/0002`.
 *
 *   POST {url}/api/v1/evidence/search
 *   Authorization: Bearer <app token>
 *   { board, query, limit }  ->  { passages: [...], semantic }
 */
export interface Passage {
  /** Stable id of the chunk or card, for deduplication. */
  id: string
  title: string
  path: string
  /** Link a person can open, when the Board has one. */
  url: string | null
  kind: 'doc' | 'issue' | 'other'
  /** Code the document carries (IS-E2-03, ADR-002). */
  code: string | null
  /** Delivery the document belongs to (E1, E2, …). */
  entrega: string | null
  /** ISO dates, for questions that depend on when something happened. */
  created: string | null
  closed: string | null
  text: string
  score: number
}

export interface EvidenceResult {
  passages: Passage[]
  /** false when the Board answered with lexical matching only. */
  semantic: boolean
}

export interface Evidence {
  /** Passages that bear on `query` for this team, or null when the team has no board or the Board is unreachable. */
  search(
    teamSlug: string,
    query: string,
    limit: number,
  ): Promise<EvidenceResult | null>
}

const TIMEOUT_MS = 8000
const MAX_TEXT = 1200
const KINDS = ['doc', 'issue'] as const

const str = (v: unknown, max = 300): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null

/** Anything the Board returns is untrusted data: keep only the fields we know, clamp them, drop what does not fit. */
export function parsePassages(body: unknown): EvidenceResult | null {
  if (!body || typeof body !== 'object') return null
  const raw = (body as { passages?: unknown; semantic?: unknown }).passages
  if (!Array.isArray(raw)) return null
  const passages = raw.flatMap((p): Passage[] => {
    if (!p || typeof p !== 'object') return []
    const o = p as Record<string, unknown>
    const id = str(o.id, 120)
    const text = str(o.text, MAX_TEXT)
    if (!id || !text) return []
    const url = str(o.url, 500)
    return [
      {
        id,
        title: str(o.title) ?? id,
        path: str(o.path, 400) ?? '',
        // A link we did not expect (javascript:, data:) never reaches the page.
        url: url && /^https?:\/\//i.test(url) ? url : null,
        kind: KINDS.find((k) => k === o.kind) ?? 'other',
        code: str(o.code, 60),
        entrega: str(o.entrega, 20),
        created: str(o.created, 40),
        closed: str(o.closed, 40),
        text,
        score:
          typeof o.score === 'number' && Number.isFinite(o.score) ? o.score : 0,
      },
    ]
  })
  return {
    passages,
    semantic: (body as { semantic?: unknown }).semantic === true,
  }
}

export interface BoardEvidenceConfig {
  url: string
  token: string
  /** team slug -> board slug. A team that is not listed has no board. */
  boards: Map<string, string>
  fetch?: typeof fetch
}

export function boardEvidence(cfg: BoardEvidenceConfig): Evidence {
  const doFetch = cfg.fetch ?? fetch
  return {
    async search(teamSlug, query, limit) {
      const board = cfg.boards.get(teamSlug)
      if (!board || !query.trim()) return null
      try {
        const res = await doFetch(`${cfg.url}/api/v1/evidence/search`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${cfg.token}`,
          },
          body: JSON.stringify({ board, query: query.slice(0, 800), limit }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (!res.ok) return null
        return parsePassages(await res.json().catch(() => null))
      } catch {
        return null
      }
    },
  }
}

/** `MYDEFENSE_BOARD_URL` + `MYDEFENSE_BOARD_TOKEN`; `MYDEFENSE_BOARD_TEAMS` is `team=board,team=board` (default `eternum=eternum`). */
export function evidenceFromEnv(
  env: Record<string, string | undefined>,
): Evidence | null {
  const url = env.MYDEFENSE_BOARD_URL?.trim().replace(/\/+$/, '')
  const token = env.MYDEFENSE_BOARD_TOKEN?.trim()
  if (!url || !token) return null
  const boards = new Map(
    (env.MYDEFENSE_BOARD_TEAMS?.trim() || 'eternum=eternum')
      .split(',')
      .flatMap((pair): [string, string][] => {
        const [team, board] = pair.split('=').map((s) => s.trim())
        return team && board ? [[team, board]] : []
      }),
  )
  return boardEvidence({ url, token, boards })
}

const PASSAGES = 6

/**
 * What the Board knows that bears on this answer. Two searches: one on the question and its stored answer (what the
 * documents say about the topic), one on what the student claimed (so a claim the stored answer lacks can still be
 * found). Merged by id, best score first. Empty when the team has no board or the Board is unreachable.
 */
export async function gatherEvidence(
  evidence: Evidence | null,
  teamSlug: string,
  q: { prompt: string; modelAnswer: string },
  answer: string,
  limit = PASSAGES,
): Promise<Passage[]> {
  if (!evidence) return []
  const [topic, claim] = await Promise.all([
    evidence.search(teamSlug, `${q.prompt} ${q.modelAnswer}`, limit),
    evidence.search(teamSlug, answer.slice(0, 500), limit),
  ])
  const best = new Map<string, Passage>()
  for (const p of [...(topic?.passages ?? []), ...(claim?.passages ?? [])]) {
    const seen = best.get(p.id)
    if (!seen || p.score > seen.score) best.set(p.id, p)
  }
  return [...best.values()]
    .toSorted((a, b) => b.score - a.score)
    .slice(0, limit)
}
