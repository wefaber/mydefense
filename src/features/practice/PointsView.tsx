import { useState } from 'react'
import { Chip } from '@wefaber/ui'
import { setRating, useProgress } from '../../lib/progress'
import type { Point } from '../../lib/queries'
import { usePracticeContext } from './context'
import { Fold, Lead, Note, PathChips, StatusTag } from './parts'

const RATES = [
  [0, 'No lo sé'],
  [1, 'Lo explico a medias'],
  [2, 'Lo domino'],
] as const

const byCode = (a: Point, b: Point) => {
  const [a1 = 0, a2 = 0] = a.code.split('.').map(Number)
  const [b1 = 0, b2 = 0] = b.code.split('.').map(Number)
  return a1 - b1 || a2 - b2
}

export function PointsView() {
  const { team, defense, me } = usePracticeContext()
  const progress = useProgress(team.slug)
  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const names = new Map(team.identities.map((i) => [i.id, i.name]))
  const questionsByPoint = Map.groupBy(
    defense.pointQuestions,
    (q) => q.pointId ?? '',
  )

  const mine = defense.points.filter((p) => p.ownerId === me.id)
  const shown = (scope === 'mine' ? mine : defense.points).toSorted(byCode)
  const sections = new Map(defense.sections.map((s) => [s.id, s]))

  return (
    <div className="flex flex-col gap-4">
      <Lead>
        Cada punto del guion con lo que hay que decir, dónde está en el código y
        las preguntas que te pueden hacer. Marcá cuánto lo dominás.
      </Lead>
      <div role="group" aria-label="Qué puntos ver" className="flex gap-2">
        <Chip selected={scope === 'mine'} onClick={() => setScope('mine')}>
          Los míos ({mine.length})
        </Chip>
        <Chip selected={scope === 'all'} onClick={() => setScope('all')}>
          Todos ({defense.points.length})
        </Chip>
      </div>
      {shown.length === 0 && (
        <p className="text-body-lg text-muted">No hay puntos en este grupo.</p>
      )}
      {shown.map((p, i) => {
        const section = sections.get(p.sectionId)
        const first = i === 0 || shown[i - 1]?.sectionId !== p.sectionId
        const rating = progress.ratings[`${me.key}|${p.code}`]
        return (
          <div key={p.id} className="flex flex-col gap-3">
            {first && section && (
              <h2 className="pt-2 text-h3 font-semibold">
                {section.number}. {section.title}
              </h2>
            )}
            <Fold
              summary={
                <>
                  <span className="mt-0.5 min-w-8 font-mono text-meta text-muted tabular-nums">
                    {p.code}
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      {p.title}
                      <StatusTag status={p.status} />
                    </span>
                    <span className="text-meta font-normal text-muted">
                      {p.script}
                      {p.ownerId !== me.id && p.ownerId
                        ? ` · presenta ${names.get(p.ownerId)}`
                        : ''}
                    </span>
                  </span>
                </>
              }
            >
              <ul className="ml-4 flex list-disc flex-col gap-1.5">
                {p.say.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <PathChips items={p.refs} />
              {p.todo && <Note label="Falta">{p.todo}</Note>}
              {(questionsByPoint.get(p.id) ?? []).map((q) => (
                <Fold key={q.id} summary={q.prompt} className="bg-surface-2">
                  <p>{q.modelAnswer}</p>
                </Fold>
              ))}
              <div
                role="group"
                aria-label="Cuánto lo domino"
                className="flex flex-wrap gap-2"
              >
                {RATES.map(([value, label]) => (
                  <Chip
                    key={value}
                    selected={rating === value}
                    onClick={() =>
                      setRating(
                        team.slug,
                        me.key,
                        p.code,
                        rating === value ? undefined : value,
                      )
                    }
                  >
                    {label}
                  </Chip>
                ))}
              </div>
            </Fold>
          </div>
        )
      })}
    </div>
  )
}
