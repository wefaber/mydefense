/**
 * The numbers of a finished session, shared by the SPA and by `server/ai/recap.ts`.
 *
 * It lives in `shared/` and not in `src/lib/` because the server calls it at runtime: the deploy artifact
 * ships `server/`, `shared/` and `dist/` only (see `deploy/mydefense.sh`), never the SPA source.
 */
import type { Grade, RecapGrading } from './types'

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
