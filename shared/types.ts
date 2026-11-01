export const VISIBILITIES = ['public', 'private'] as const
export type Visibility = (typeof VISIBILITIES)[number]

/** Where a practice question comes from. Own/cross is derived from the point's owner, not stored. */
export const QUESTION_GROUPS = ['point', 'bank', 'topic', 'custom'] as const
export type QuestionGroup = (typeof QUESTION_GROUPS)[number]

export const QUESTION_STATUSES = ['draft', 'validated', 'approved'] as const
export type QuestionStatus = (typeof QUESTION_STATUSES)[number]

/** ok = checked against the source, fill = the team must complete it, pend = still to define. */
export const POINT_STATUSES = ['ok', 'fill', 'pend'] as const
export type PointStatus = (typeof POINT_STATUSES)[number]

export const RESOURCE_KINDS = ['exercise', 'fact', 'pending', 'lesson'] as const
export type ResourceKind = (typeof RESOURCE_KINDS)[number]

/** Self-grading scale shown to the user. */
export const GRADES = ['complete', 'partial', 'insufficient'] as const
export type Grade = (typeof GRADES)[number]

/** Page size limits for list fields. */
export const PAGE_MAX = 100
export const clampPage = (n: number | null | undefined): number =>
  Math.min(PAGE_MAX, Math.max(1, Math.trunc(n ?? PAGE_MAX)))
