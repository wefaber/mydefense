import { AlertTriangle, CircleCheck, CircleDashed } from 'lucide-react'
import type { ReactNode } from 'react'
import type { PointStatus } from '../../../shared/types'

const STATUS: Record<
  PointStatus,
  { label: string; tone: string; Icon: typeof CircleCheck }
> = {
  ok: { label: 'verificado', tone: 'text-success', Icon: CircleCheck },
  fill: { label: 'completar', tone: 'text-warning', Icon: AlertTriangle },
  pend: { label: 'definir', tone: 'text-danger', Icon: CircleDashed },
}

export function StatusTag({ status }: { status: PointStatus }) {
  const { label, tone, Icon } = STATUS[status]
  return (
    <span
      className={`inline-flex items-center gap-1 text-meta font-medium ${tone}`}
    >
      <Icon aria-hidden size={14} />
      {label}
    </span>
  )
}

export function PathChips({ items }: { items: string[] }) {
  if (!items.length) return null
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Dónde está en el código">
      {items.map((p) => (
        <li
          key={p}
          className="rounded-control bg-surface-2 px-2 py-0.5 font-mono text-meta text-muted"
        >
          {p}
        </li>
      ))}
    </ul>
  )
}

/** Collapsible card: a native `details`, so keyboard and screen readers work for free. */
export function Fold({
  summary,
  children,
  className = '',
}: {
  summary: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <details
      className={`group rounded-card border border-border bg-surface ${className}`}
    >
      <summary className="flex min-h-11 items-start gap-3 rounded-card px-4 py-3 text-body-lg font-medium text-text marker:content-none [&::-webkit-details-marker]:hidden">
        {summary}
      </summary>
      <div className="flex flex-col gap-3 border-t border-border px-4 py-3 text-body-lg text-text">
        {children}
      </div>
    </details>
  )
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="max-w-prose text-body-lg text-muted">{children}</p>
}

export function Note({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="rounded-card bg-surface-2 px-3 py-2 text-body-lg">
      <b className="mb-0.5 block text-meta font-semibold text-muted">{label}</b>
      {children}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-card border border-dashed border-border px-4 py-6 text-center text-body-lg text-muted">
      {children}
    </p>
  )
}
