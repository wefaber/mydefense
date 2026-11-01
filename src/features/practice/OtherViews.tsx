import { asString, asStrings } from '../../lib/coerce'
import { usePracticeContext } from './context'
import { Empty, Fold, Lead, Note, PathChips } from './parts'

export function BankView() {
  const { defense } = usePracticeContext()
  return (
    <div className="flex flex-col gap-3">
      <Lead>
        Banco de {defense.bank.length} preguntas. Cada una trae lo que se espera
        y cómo se responde con lo que el equipo hizo de verdad.
      </Lead>
      {defense.bank.length === 0 && (
        <Empty>Todavía no hay preguntas en el banco.</Empty>
      )}
      {defense.bank.map((q) => {
        const cmds = asStrings(q.extra.cmds)
        return (
          <Fold
            key={q.id}
            summary={
              <>
                <span className="mt-0.5 min-w-16 font-mono text-meta text-muted">
                  {q.source}
                </span>
                <span>{q.prompt}</span>
              </>
            }
          >
            <Note label="Lo que se espera">{asString(q.extra.expected)}</Note>
            <Note label="Cómo lo responde el equipo">{q.modelAnswer}</Note>
            <PathChips items={cmds} />
            {asString(q.extra.todo) && (
              <Note label="Falta">{asString(q.extra.todo)}</Note>
            )}
          </Fold>
        )
      })}
    </div>
  )
}

export function TopicsView() {
  const { defense } = usePracticeContext()
  return (
    <div className="flex flex-col gap-3">
      <Lead>
        Los temas que te pueden preguntar, con la explicación y el código donde
        mirar.
      </Lead>
      {defense.lessons.length === 0 && <Empty>No hay temas cargados.</Empty>}
      {defense.lessons.map((t) => {
        const n = Number(t.body.n)
        const questions = defense.topicQuestions.filter(
          (q) => Number(q.extra.topic) === n,
        )
        return (
          <Fold
            key={t.id}
            summary={
              <>
                <span className="mt-0.5 min-w-6 font-mono text-meta text-muted tabular-nums">
                  {n}
                </span>
                <span>{t.title}</span>
              </>
            }
          >
            {asStrings(t.body.lesson).map((p) => (
              <p key={p}>{p}</p>
            ))}
            <PathChips items={asStrings(t.body.code)} />
            {questions.map((q) => (
              <Fold key={q.id} summary={q.prompt} className="bg-surface-2">
                <p>{q.modelAnswer}</p>
              </Fold>
            ))}
          </Fold>
        )
      })}
    </div>
  )
}

export function ExercisesView() {
  const { defense } = usePracticeContext()
  return (
    <div className="flex flex-col gap-3">
      <Lead>Ejercicios cortos para practicar sobre el proyecto real.</Lead>
      {defense.exercises.length === 0 && (
        <Empty>No hay ejercicios cargados.</Empty>
      )}
      {defense.exercises.map((e) => (
        <Fold
          key={e.id}
          summary={
            <>
              <span>{e.title}</span>
              <span className="ml-auto font-mono text-meta text-muted tabular-nums">
                {asString(e.body.time)}
              </span>
            </>
          }
        >
          <Note label="Objetivo">{asString(e.body.goal)}</Note>
          <ol className="ml-4 flex list-decimal flex-col gap-1.5">
            {asStrings(e.body.steps).map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <PathChips items={asStrings(e.body.files)} />
          <Note label="Qué practicás">{asString(e.body.learn)}</Note>
        </Fold>
      ))}
    </div>
  )
}

export function PendingView() {
  const { defense } = usePracticeContext()
  return (
    <div className="flex flex-col gap-3">
      <Lead>
        Lo que el equipo todavía tiene que definir o verificar antes de la
        defensa.
      </Lead>
      {defense.pending.length === 0 && <Empty>No queda nada pendiente.</Empty>}
      {defense.pending.map((p) => (
        <div
          key={p.id}
          className="rounded-card border border-border bg-surface px-4 py-3"
        >
          <b className="block text-body-lg">{p.title}</b>
          <p className="text-body-lg text-muted">{asString(p.body.text)}</p>
        </div>
      ))}
    </div>
  )
}

export function FactsView() {
  const { defense } = usePracticeContext()
  return (
    <div className="flex flex-col gap-4">
      <Lead>Números y datos del proyecto, con de dónde salen.</Lead>
      <dl className="divide-y divide-border rounded-card border border-border bg-surface">
        {defense.facts.map((f) => (
          <div
            key={f.id}
            className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr]"
          >
            <dt className="text-body-lg text-muted">{f.title}</dt>
            <dd className="text-body-lg">
              <span className="font-medium tabular-nums">
                {asString(f.body.value)}
              </span>
              <span className="block font-mono text-meta text-muted">
                {asString(f.body.source)}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      {defense.criteria.length > 0 && (
        <>
          <h2 className="text-h3 font-semibold">Criterios de evaluación</h2>
          <ul className="flex flex-col gap-2">
            {defense.criteria.map((c) => (
              <li
                key={c.name}
                className="rounded-card border border-border bg-surface px-4 py-3 text-body-lg"
              >
                <b>{c.name}</b>
                <span className="block text-muted">{c.description}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
