import type { ReactNode } from 'react'

/** Label, control, why-we-ask hint and the error once the field was touched. The control must use the same `id`. */
export function FormField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string | null
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-body-lg font-medium">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-meta text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-meta text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

/** Live summary above a submit button: what is missing or does not add up. Each item moves focus to its field. */
export function IssueSummary({
  issues,
}: {
  issues: { id: string; message: string }[]
}) {
  return (
    <div aria-live="polite" className="min-h-5 text-body-lg">
      {issues.length > 0 && (
        <ul className="flex flex-col gap-1 text-danger">
          {issues.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                className="underline"
                onClick={() => document.getElementById(i.id)?.focus()}
              >
                {i.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
