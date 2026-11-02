import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Textarea } from '@wefaber/ui'
import { useState } from 'react'
import {
  CRITERIA_LABELS,
  NOTE_MAX_CHARS,
  recapSession,
  type Grading,
  type Recap,
} from '../../lib/answer'
import type { Question } from '../../lib/queries'
import { recapAnswers, summarize, type RunResult } from '../../lib/simulacro'
import { GradingPanel } from './AnswerBox'
import { Fold, Note } from './parts'

const VERDICT_LABEL = {
  complete: 'Completa',
  partial: 'Parcial',
  insufficient: 'Insuficiente',
} as const

type RecapInput = ReturnType<typeof recapAnswers>

/**
 * The end of a quiz round or a simulacro: the numbers come from code, then the reading the model writes over them,
 * then the answers the model does not agree with. Both the reading and each correction can be disputed; a dispute
 * is answered by a new reading (or a new correction), never by insisting.
 * If the model gives no reading, the numbers stand alone.
 */
export function SessionRecap({
  teamSlug,
  results,
  title,
  onRevised,
}: {
  teamSlug: string
  results: RunResult<Question>[]
  title: string
  onRevised: (questionId: string, g: Grading) => void
}) {
  const s = summarize(results)

  return (
    <div className="flex flex-col gap-5">
      <section
        aria-label={title}
        className="flex flex-col gap-4 rounded-tile border border-border bg-surface p-tile"
      >
        <h2 className="text-h2 font-semibold">{title}</h2>
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
        {s.graded > 0 && <Reading teamSlug={teamSlug} results={results} />}
      </section>
      <Disagreements
        teamSlug={teamSlug}
        results={results}
        onRevised={onRevised}
      />
    </div>
  )
}

/** The reading the model writes, or the state while it writes it. Mounted only when something was graded. */
function Reading({
  teamSlug,
  results,
}: {
  teamSlug: string
  results: RunResult<Question>[]
}) {
  const answers = recapAnswers(results)
  const key = ['session-recap', teamSlug, answers]
  const queryClient = useQueryClient()
  const reading = useQuery({
    queryKey: key,
    queryFn: () => recapSession({ teamSlug, answers }),
    staleTime: Infinity,
    retry: false,
  })

  if (reading.isPending)
    return (
      <p className="text-meta text-muted" aria-live="polite">
        Redactando la lectura de la sesión…
      </p>
    )
  if (!reading.data)
    return (
      <p className="text-meta text-muted">
        No pudimos redactar la lectura de la sesión. Quedan los números.
      </p>
    )

  const recap = reading.data
  return (
    <div className="flex flex-col gap-4">
      <p className="text-body-lg">{recap.analysis}</p>
      {recap.strengths.length > 0 && (
        <ReadingList title="Lo que sostuviste" items={recap.strengths} />
      )}
      {recap.gaps.length > 0 && (
        <ReadingList title="Para la próxima" items={recap.gaps} />
      )}
      <p className="text-body-lg font-semibold">{recap.conclusion}</p>
      <Dispute
        teamSlug={teamSlug}
        answers={answers}
        previous={recap}
        onRevised={(next) => queryClient.setQueryData(key, next)}
      />
    </div>
  )
}

/** The student's disagreement with a reading. A null reply keeps the previous reading. */
function Dispute({
  teamSlug,
  answers,
  previous,
  onRevised,
}: {
  teamSlug: string
  answers: RecapInput
  previous: Recap
  onRevised: (recap: Recap) => void
}) {
  const [disputing, setDisputing] = useState(false)
  const [dispute, setDispute] = useState('')
  // No invalidation: onSuccess hands the new reading to the parent, which writes it into the reading's
  // query cache with setQueryData. That key is the only query this reading depends on, so a refetch would
  // only repeat the model call the dispute just made.
  const reconsider = useMutation({
    mutationFn: () =>
      recapSession({ teamSlug, answers, previous, dispute: dispute.trim() }),
    onSuccess: (recap) => {
      if (!recap) return
      onRevised(recap)
      setDisputing(false)
      setDispute('')
    },
  })

  if (!disputing)
    return (
      <div>
        <Button variant="secondary" onClick={() => setDisputing(true)}>
          No estoy de acuerdo con la lectura
        </Button>
      </div>
    )

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="reading-dispute" className="text-meta text-muted">
        ¿Qué no te cierra de esta lectura? Explicalo.
      </label>
      <Textarea
        id="reading-dispute"
        rows={3}
        maxLength={NOTE_MAX_CHARS}
        value={dispute}
        onChange={(e) => setDispute(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          disabled={reconsider.isPending || dispute.trim() === ''}
          onClick={() => reconsider.mutate()}
        >
          {reconsider.isPending ? 'Releyendo…' : 'Reevaluar la lectura'}
        </Button>
        <Button variant="secondary" onClick={() => setDisputing(false)}>
          Cancelar
        </Button>
      </div>
      {(reconsider.isError ||
        (reconsider.isSuccess && reconsider.data === null)) && (
        <p className="text-meta text-muted">
          No pudimos reevaluar la lectura. Queda la anterior.
        </p>
      )}
    </div>
  )
}

/** The answers the model does not agree with, each with its correction and the model answer. */
function Disagreements({
  teamSlug,
  results,
  onRevised,
}: {
  teamSlug: string
  results: RunResult<Question>[]
  onRevised: (questionId: string, g: Grading) => void
}) {
  const disagreed = results.filter((r) => r.grading?.verdict !== 'complete')
  if (disagreed.length === 0) return null

  return (
    <section aria-label="Donde no coincidimos" className="flex flex-col gap-2">
      <h3 className="text-h3 font-semibold">Donde no coincidimos</h3>
      {disagreed.map((r) => (
        <Fold
          key={r.question.id}
          summary={
            <span className="flex flex-col">
              <span className="text-meta text-muted">
                {r.question.source} ·{' '}
                {r.grading ? VERDICT_LABEL[r.grading.verdict] : 'Sin corregir'}
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
  )
}

function ReadingList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-meta font-semibold text-muted">{title}</h3>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-body-lg">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}
