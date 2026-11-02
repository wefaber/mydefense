import type { RecapAnswer } from '../../shared/types'
import type { Grading } from './answer'

/**
 * The session numbers live in `shared/` because the server reads them too (see `shared/simulacro.ts`); they are
 * re-exported here so the SPA keeps importing one module.
 */
export {
  summarize,
  type RunSummary,
  type SummaryGrade,
} from '../../shared/simulacro'

/** Just what a run needs from a question and a point, so it stays testable without the whole practice payload. */
export interface RunQuestion {
  id: string
  pointId: string | null
  prompt: string
  modelAnswer: string
  source: string
}
export interface RunPoint {
  id: string
  ownerId: string | null
}

export const SIZES = [
  ['corto', 'Corto', 5],
  ['normal', 'Normal', 8],
  ['largo', 'Largo', 12],
] as const
export const SECONDS = [60, 90, 120] as const

export type Rand = () => number

function shuffle<T>(items: T[], rand: Rand): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/**
 * The questions of a mock defense: first the student's own points in presentation order (one question each, as when
 * presenting), then the tribunal's cross questions on everyone else's. About 60% own, the rest cross.
 */
export function buildRun<Q extends RunQuestion>(
  points: RunPoint[],
  pointQuestions: Q[],
  meId: string,
  size: number,
  rand: Rand = Math.random,
): Q[] {
  const order = new Map(points.map((p, i) => [p.id, i]))
  const owner = new Map(points.map((p) => [p.id, p.ownerId]))
  const mine = pointQuestions.filter((q) => owner.get(q.pointId ?? '') === meId)
  const others = pointQuestions.filter(
    (q) => owner.get(q.pointId ?? '') !== meId,
  )
  const byPoint = new Map<string, Q[]>()
  for (const q of mine) {
    const key = q.pointId ?? ''
    byPoint.set(key, [...(byPoint.get(key) ?? []), q])
  }
  const ownCount = Math.min(Math.ceil(size * 0.6), byPoint.size)
  const own = [...byPoint.entries()]
    .toSorted(([a], [b]) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    .slice(0, ownCount)
    .map(([, qs]) => shuffle(qs, rand)[0]!)
  const cross = shuffle(others, rand).slice(0, size - own.length)
  return [...own, ...cross]
}

export interface RunResult<Q extends RunQuestion = RunQuestion> {
  question: Q
  /** null when the question was skipped or could not be graded. */
  grading: Grading | null
}

/** What the session recap sends the model per answer: the verdict and what it hung on. The student's wording stays here. */
export function recapAnswers(results: RunResult[]): RecapAnswer[] {
  return results.map((r) => ({
    question: r.question.prompt,
    grading: r.grading && {
      verdict: r.grading.verdict,
      criteria: r.grading.criteria,
      covered: r.grading.covered,
      missing: r.grading.missing,
      unsupported: r.grading.unsupported,
      referenceIssue: r.grading.referenceIssue,
      argument: r.grading.argument,
      delivery: r.grading.delivery && {
        wpm: r.grading.delivery.wpm,
        fillers: r.grading.delivery.fillers,
      },
    },
  }))
}
