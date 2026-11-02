import type { Grade, RecapAnswer, RecapGrading } from '../../shared/types'
import type { Grading } from './answer'

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

export interface RunSummary {
  total: number
  graded: number
  byVerdict: Record<Grade, number>
  /** Average 0..4 per criterion over the graded answers, one decimal. */
  criteria: { content: number; terminology: number; structure: number }
  /** Average words per minute over the spoken answers; null when none was spoken. */
  wpm: number | null
  fillers: number
}

const avg = (xs: number[]) =>
  xs.length
    ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10
    : 0

/** The part of a grading the numbers read. */
export type SummaryGrade = Pick<
  RecapGrading,
  'verdict' | 'criteria' | 'delivery'
>

export function summarize<R extends { grading: SummaryGrade | null }>(
  results: R[],
): RunSummary {
  const graded = results.flatMap((r) => (r.grading ? [r.grading] : []))
  const byVerdict: Record<Grade, number> = {
    complete: 0,
    partial: 0,
    insufficient: 0,
  }
  for (const g of graded) byVerdict[g.verdict]++
  const wpms = graded.flatMap((g) =>
    g.delivery?.wpm != null ? [g.delivery.wpm] : [],
  )
  return {
    total: results.length,
    graded: graded.length,
    byVerdict,
    criteria: {
      content: avg(graded.map((g) => g.criteria.content)),
      terminology: avg(graded.map((g) => g.criteria.terminology)),
      structure: avg(graded.map((g) => g.criteria.structure)),
    },
    wpm: wpms.length ? Math.round(avg(wpms)) : null,
    fillers: graded.reduce(
      (n, g) => n + (g.delivery?.fillers.reduce((m, f) => m + f.count, 0) ?? 0),
      0,
    ),
  }
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
