import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button, Chip } from '@wefaber/ui'
import type { Grade } from '../../../shared/types'
import { capabilitiesQuery, type Grading } from '../../lib/answer'
import { addGrade, useProgress } from '../../lib/progress'
import type { Question } from '../../lib/queries'
import type { RunResult } from '../../lib/simulacro'
import { usePracticeContext } from './context'
import { asString } from '../../lib/coerce'
import { AnswerBox, GradingPanel } from './AnswerBox'
import { Empty, Lead, Note } from './parts'
import { SessionRecap } from './SessionRecap'

type Pool = 'mine' | 'cross' | 'bank' | 'topic'

const POOLS: [Pool, string][] = [
  ['mine', 'Mis puntos'],
  ['cross', 'Cruzadas'],
  ['bank', 'Banco'],
  ['topic', 'Temas'],
]

const GRADES: [Grade, string][] = [
  ['complete', 'Completa'],
  ['partial', 'Parcial'],
  ['insufficient', 'Insuficiente'],
]

function shuffle<T>(items: T[]): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** The end of a round: the recap when grading is on and something was graded, else the plain tally. */
function RoundEnd({
  teamSlug,
  round,
  grading,
  onRevised,
  onRestart,
}: {
  teamSlug: string
  round: (RunResult<Question> & { verdict: Grade })[]
  grading: boolean | undefined
  onRevised: (questionId: string, g: Grading) => void
  onRestart: () => void
}) {
  const count = (g: Grade) => round.filter((a) => a.verdict === g).length
  const anyGraded = round.some((a) => a.grading)
  return (
    <div className="flex flex-col gap-4">
      {grading && anyGraded ? (
        <SessionRecap
          teamSlug={teamSlug}
          results={round}
          title="Resultado de la ronda"
          onRevised={onRevised}
        />
      ) : (
        <p className="text-body-lg">
          Ronda: {count('complete')} completas, {count('partial')} parciales,{' '}
          {count('insufficient')} insuficientes.
        </p>
      )}
      <div>
        <Button size="lg" variant="primary" onClick={onRestart}>
          Seguir practicando
        </Button>
      </div>
    </div>
  )
}

/** The correction of an answered question and the student's own verdict on it. */
function Correction({
  question,
  graded,
  teamSlug,
  onRevised,
  onGrade,
}: {
  question: Question
  graded: Grading | null
  teamSlug: string
  onRevised: (g: Grading) => void
  onGrade: (g: Grade) => void
}) {
  return (
    <>
      {graded && (
        <GradingPanel
          grading={graded}
          revision={{
            teamSlug,
            questionId: question.id,
            onRevised,
          }}
        />
      )}
      <Note label="Respuesta">{question.modelAnswer}</Note>
      {asString(question.extra.expected) && (
        <Note label="Lo que se espera">
          {asString(question.extra.expected)}
        </Note>
      )}
      <GradeChoices suggested={graded?.verdict} onGrade={onGrade} />
    </>
  )
}

function GradeChoices({
  suggested,
  onGrade,
}: {
  suggested: Grade | undefined
  onGrade: (g: Grade) => void
}) {
  return (
    <div role="group" aria-label="Cómo te fue" className="flex flex-wrap gap-2">
      {GRADES.map(([g, label]) => (
        <Button
          key={g}
          size="lg"
          variant={g === (suggested ?? 'complete') ? 'primary' : 'secondary'}
          onClick={() => onGrade(g)}
        >
          {suggested === g ? `${label} (sugerida)` : label}
        </Button>
      ))}
    </div>
  )
}

export function QuizView() {
  const { team, defense, me } = usePracticeContext()
  const progress = useProgress(team.slug)
  const owners = new Map(defense.points.map((p) => [p.id, p.ownerId]))

  const poolOf = (kind: Pool): Question[] => {
    if (kind === 'bank') return defense.bank
    if (kind === 'topic') return defense.topicQuestions
    const own = kind === 'mine'
    return defense.pointQuestions.filter(
      (q) => (owners.get(q.pointId ?? '') === me.id) === own,
    )
  }

  const [pool, setPool] = useState<Pool>('mine')
  const [queue, setQueue] = useState<Question[]>(() => shuffle(poolOf('mine')))
  const [shown, setShown] = useState(false)
  const [graded, setGraded] = useState<Grading | null>(null)
  // The round so far: each answer with its correction (when there was one) and the verdict the student settled on.
  const [round, setRound] = useState<
    (RunResult<Question> & { verdict: Grade })[]
  >([])
  const [ended, setEnded] = useState(false)
  const caps = useQuery(capabilitiesQuery).data

  const current = queue.at(-1) ?? null

  const choose = (kind: Pool) => {
    setPool(kind)
    setQueue(shuffle(poolOf(kind)))
    setShown(false)
    setGraded(null)
  }

  const grade = (g: Grade) => {
    addGrade(team.slug, me.key, g)
    if (current)
      setRound((all) => [
        ...all,
        { question: current, grading: graded, verdict: g },
      ])
    const rest = queue.slice(0, -1)
    setQueue(rest.length ? rest : shuffle(poolOf(pool)))
    setShown(false)
    setGraded(null)
  }

  const tally = progress.quiz[me.key] ?? {
    complete: 0,
    partial: 0,
    insufficient: 0,
  }

  if (ended) {
    return (
      <RoundEnd
        teamSlug={team.slug}
        round={round}
        grading={caps?.grading}
        onRevised={(id, g) =>
          setRound((all) =>
            all.map((a) => (a.question.id === id ? { ...a, grading: g } : a)),
          )
        }
        onRestart={() => {
          setRound([])
          setEnded(false)
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Lead>
        {caps?.grading
          ? 'Leé la pregunta y respondé como en la defensa: escribila o grabala. Te corregimos contra el material del proyecto.'
          : 'Leé la pregunta, respondé en voz alta y recién ahí mirá la respuesta. Después puntuate con honestidad.'}
      </Lead>
      <div
        role="group"
        aria-label="De dónde salen las preguntas"
        className="flex flex-wrap gap-2"
      >
        {POOLS.map(([kind, label]) => (
          <Chip
            key={kind}
            selected={pool === kind}
            onClick={() => choose(kind)}
          >
            {label}
          </Chip>
        ))}
      </div>
      {current ? (
        <section
          aria-label="Pregunta"
          className="flex flex-col gap-4 rounded-tile border border-border bg-surface p-tile"
        >
          <p className="text-meta text-muted">{current.source}</p>
          <p className="text-h2 font-semibold">{current.prompt}</p>
          {caps?.grading && !shown && (
            <AnswerBox
              key={current.id}
              teamSlug={team.slug}
              questionId={current.id}
              voice={caps.voice}
              onGraded={(g) => {
                setGraded(g)
                setShown(true)
              }}
            />
          )}
          {shown ? (
            <Correction
              question={current}
              graded={graded}
              teamSlug={team.slug}
              onRevised={setGraded}
              onGrade={grade}
            />
          ) : (
            <div>
              <Button
                size="lg"
                variant={caps?.grading ? 'secondary' : 'primary'}
                onClick={() => setShown(true)}
              >
                {caps?.grading ? 'Saltear y ver respuesta' : 'Ver respuesta'}
              </Button>
            </div>
          )}
        </section>
      ) : (
        <Empty>No hay preguntas en este grupo.</Empty>
      )}
      <p className="text-body-lg text-muted" aria-live="polite">
        Tus respuestas: {tally.complete} completas, {tally.partial} parciales,{' '}
        {tally.insufficient} insuficientes. Tu progreso queda en este navegador.
      </p>
      {round.length > 0 && (
        <div>
          <Button variant="secondary" onClick={() => setEnded(true)}>
            Terminar y ver el resumen
          </Button>
        </div>
      )}
    </div>
  )
}
