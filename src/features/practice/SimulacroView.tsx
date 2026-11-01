import { useQuery } from '@tanstack/react-query'
import { Button, Chip } from '@wefaber/ui'
import { Timer } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  CRITERIA_LABELS,
  capabilitiesQuery,
  type Grading,
} from '../../lib/answer'
import { addGrade } from '../../lib/progress'
import type { Question } from '../../lib/queries'
import {
  SECONDS,
  SIZES,
  buildRun,
  summarize,
  type RunResult,
} from '../../lib/simulacro'
import { AnswerBox, GradingPanel } from './AnswerBox'
import { usePracticeContext } from './context'
import { Empty, Fold, Lead, Note } from './parts'

const VERDICT_LABEL = {
  complete: 'Completa',
  partial: 'Parcial',
  insufficient: 'Insuficiente',
} as const

/** Ticks while `active`; the clock is wall time, so a throttled background tab still shows the right second. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [active])
  return now
}

/**
 * A mock defense: your own points in presentation order, then the tribunal's cross questions, each with a clock.
 * When the clock runs out whatever you have is submitted. The model answers wait until the end.
 */
export function SimulacroView() {
  const { team, defense, me } = usePracticeContext()
  const caps = useQuery(capabilitiesQuery).data
  const [size, setSize] = useState<number>(SIZES[1][2])
  const [seconds, setSeconds] = useState<number>(SECONDS[1])
  const [run, setRun] = useState<Question[] | null>(null)
  const [index, setIndex] = useState(0)
  const [deadline, setDeadline] = useState(0)
  const [graded, setGraded] = useState<Grading | null>(null)
  const [skipped, setSkipped] = useState(false)
  const [results, setResults] = useState<RunResult<Question>[]>([])

  const answering = !!run && index < run.length && !graded && !skipped
  const now = useNow(answering)

  if (caps && !caps.grading) {
    return (
      <Empty>
        El simulacro necesita la corrección automática, que no está activa en
        este servidor.
      </Empty>
    )
  }

  const begin = () => {
    const questions = buildRun(
      defense.points,
      defense.pointQuestions,
      me.id,
      size,
    )
    setRun(questions)
    setResults([])
    setIndex(0)
    setGraded(null)
    setSkipped(false)
    setDeadline(Date.now() + seconds * 1000)
  }

  const next = () => {
    if (!run) return
    const question = run[index]!
    // Counted here, not when graded, so a reviewed verdict is the one that stays.
    if (graded) addGrade(team.slug, me.key, graded.verdict)
    setResults((r) => [...r, { question, grading: graded }])
    setIndex(index + 1)
    setGraded(null)
    setSkipped(false)
    setDeadline(Date.now() + seconds * 1000)
  }

  if (!run) {
    return (
      <div className="flex flex-col gap-4">
        <Lead>
          Ensayá como en la defensa: primero tus puntos en el orden en que los
          presentás y después las preguntas cruzadas del tribunal. Cada pregunta
          tiene su tiempo; al terminar se corrige lo que tengas. Las respuestas
          modelo aparecen recién al final.
        </Lead>
        <div
          role="group"
          aria-label="Cantidad de preguntas"
          className="flex flex-wrap gap-2"
        >
          {SIZES.map(([id, label, n]) => (
            <Chip key={id} selected={size === n} onClick={() => setSize(n)}>
              {label} ({n})
            </Chip>
          ))}
        </div>
        <div
          role="group"
          aria-label="Tiempo por pregunta"
          className="flex flex-wrap gap-2"
        >
          {SECONDS.map((s) => (
            <Chip
              key={s}
              selected={seconds === s}
              onClick={() => setSeconds(s)}
            >
              {s} s por pregunta
            </Chip>
          ))}
        </div>
        <div>
          <Button size="lg" variant="primary" disabled={!caps} onClick={begin}>
            Empezar simulacro
          </Button>
        </div>
      </div>
    )
  }

  if (index >= run.length) {
    return (
      <Summary
        results={results}
        teamSlug={team.slug}
        onRevised={(id, g) =>
          setResults((all) =>
            all.map((r) => (r.question.id === id ? { ...r, grading: g } : r)),
          )
        }
        onAgain={() => setRun(null)}
      />
    )
  }

  const question = run[index]!
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000))
  const expired = answering && remaining === 0
  const last = index === run.length - 1

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-body-lg text-muted">
          Pregunta {index + 1} de {run.length}
        </p>
        {answering && (
          <p
            role="timer"
            aria-label={`${remaining} segundos restantes`}
            className={`flex items-center gap-1.5 text-h3 font-semibold tabular-nums ${remaining <= 15 ? 'text-danger' : ''}`}
          >
            <Timer aria-hidden size={18} />
            {Math.floor(remaining / 60)}:
            {String(remaining % 60).padStart(2, '0')}
          </p>
        )}
      </div>
      <section
        aria-label="Pregunta del tribunal"
        className="flex flex-col gap-4 rounded-tile border border-border bg-surface p-tile"
      >
        <p className="text-meta text-muted">{question.source}</p>
        <p className="text-h2 font-semibold">{question.prompt}</p>
        {answering && (
          <>
            <AnswerBox
              key={question.id}
              teamSlug={team.slug}
              questionId={question.id}
              voice={caps?.voice ?? false}
              expired={expired}
              onGraded={setGraded}
            />
            <div>
              <Button variant="secondary" onClick={() => setSkipped(true)}>
                Saltear esta pregunta
              </Button>
            </div>
          </>
        )}
        {graded && (
          <GradingPanel
            grading={graded}
            revision={{
              teamSlug: team.slug,
              questionId: question.id,
              onRevised: setGraded,
            }}
          />
        )}
        {skipped && (
          <p className="text-body-lg text-muted">Pregunta salteada.</p>
        )}
        {(graded || skipped) && (
          <div>
            <Button size="lg" variant="primary" onClick={next}>
              {last ? 'Ver resultado' : 'Siguiente pregunta'}
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}

function Summary({
  results,
  teamSlug,
  onRevised,
  onAgain,
}: {
  results: RunResult<Question>[]
  teamSlug: string
  onRevised: (questionId: string, g: Grading) => void
  onAgain: () => void
}) {
  const s = summarize(results)
  const review = results.filter((r) => r.grading?.verdict !== 'complete')
  return (
    <div className="flex flex-col gap-5">
      <section
        aria-label="Resultado"
        className="flex flex-col gap-3 rounded-tile border border-border bg-surface p-tile"
      >
        <h2 className="text-h2 font-semibold">Resultado del simulacro</h2>
        <p className="text-body-lg">
          {s.byVerdict.complete} completas, {s.byVerdict.partial} parciales,{' '}
          {s.byVerdict.insufficient} insuficientes
          {s.total > s.graded && <>, {s.total - s.graded} sin corregir</>}.
        </p>
        {s.graded > 0 && (
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-3">
            {(
              Object.keys(CRITERIA_LABELS) as (keyof typeof CRITERIA_LABELS)[]
            ).map((k) => (
              <div key={k}>
                <dt className="text-meta text-muted">{CRITERIA_LABELS[k]}</dt>
                <dd className="text-body-lg font-medium tabular-nums">
                  {s.criteria[k]} / 4
                </dd>
              </div>
            ))}
          </dl>
        )}
        {(s.wpm !== null || s.fillers > 0) && (
          <p className="text-meta text-muted">
            {s.wpm !== null && <>Ritmo medio {s.wpm} palabras por minuto. </>}
            {s.fillers > 0 && <>{s.fillers} muletillas en total.</>}
          </p>
        )}
      </section>
      {review.length > 0 && (
        <section aria-label="Para repasar" className="flex flex-col gap-2">
          <h3 className="text-h3 font-semibold">Para repasar</h3>
          {review.map((r) => (
            <Fold
              key={r.question.id}
              summary={
                <span className="flex flex-col">
                  <span className="text-meta text-muted">
                    {r.question.source} ·{' '}
                    {r.grading
                      ? VERDICT_LABEL[r.grading.verdict]
                      : 'Sin corregir'}
                  </span>
                  {r.question.prompt}
                </span>
              }
            >
              {r.grading && (
                <GradingPanel
                  grading={r.grading}
                  revision={{
                    teamSlug,
                    questionId: r.question.id,
                    onRevised: (g) => onRevised(r.question.id, g),
                  }}
                />
              )}
              <Note label="Respuesta">{r.question.modelAnswer}</Note>
            </Fold>
          ))}
        </section>
      )}
      <div>
        <Button size="lg" variant="primary" onClick={onAgain}>
          Hacer otro simulacro
        </Button>
      </div>
    </div>
  )
}
