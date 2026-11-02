import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Chip, Dialog, SectionTransition } from '@wefaber/ui'
import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import {
  approveDraft,
  discardDraft,
  generateDefense,
  generationQuery,
  type Draft,
  type Generation,
  type ManagedTeam,
} from '../../lib/manage'
import { Empty } from '../practice/parts'

const Err = ({ children }: { children: string | null | undefined }) =>
  children ? (
    <p role="alert" className="text-body-lg text-danger">
      {children}
    </p>
  ) : null

/** Draft of the defense generated from the indexed sources. Nothing is public until a director approves it. */
export function DefenseArea({
  team,
  director,
}: {
  team: ManagedTeam
  director: boolean
}) {
  const client = useQueryClient()
  const generation = useQuery({
    ...generationQuery(team.slug),
    enabled: director,
  })
  const refresh = () =>
    client.invalidateQueries({ queryKey: ['generation', team.slug] })
  const start = useMutation({
    mutationFn: () => generateDefense(team.id),
    onSuccess: refresh,
  })

  if (!director) {
    return (
      <Empty>Solo la dirección del equipo arma y aprueba la defensa.</Empty>
    )
  }
  const run = generation.data
  const hasSources = team.sources.length > 0

  return (
    <section className="flex max-w-prose flex-col gap-4">
      <h3 className="text-h3 font-semibold">Armar la defensa del material</h3>
      <p className="text-body-lg text-muted">
        Leemos las fuentes indexadas y proponemos secciones, puntos y preguntas.
        Es un borrador: cada pregunta lleva la cita que la respalda y nada se
        publica hasta que lo apruebes.
      </p>
      {!hasSources && (
        <Empty>Primero indexá una fuente de GitHub en Materiales.</Empty>
      )}
      {run?.status === 'running' && <Progress run={run} />}
      {run?.status === 'failed' && (
        <Err>{run.error || 'La generación falló.'}</Err>
      )}
      {run?.status === 'approved' && (
        <p className="text-body-lg">Defensa aprobada. Ya se puede practicar.</p>
      )}
      {run?.status === 'ready' && run.draft && (
        <Review team={team} run={run} draft={run.draft} onDone={refresh} />
      )}
      {run?.status !== 'running' && run?.status !== 'ready' && (
        <div className="flex flex-col gap-2">
          <div>
            <Button
              variant="primary"
              size="lg"
              disabled={
                !hasSources || start.isPending || run?.status === 'approved'
              }
              onClick={() => start.mutate()}
            >
              <Sparkles aria-hidden size={16} />
              {start.isPending ? 'Iniciando…' : 'Generar borrador'}
            </Button>
          </div>
          <Err>{start.error?.message}</Err>
        </div>
      )}
    </section>
  )
}

function Progress({ run }: { run: Generation }) {
  const label =
    run.phase === 'outline'
      ? 'Armando el índice…'
      : `Preparando puntos: ${run.done} de ${run.total}`
  return (
    <div role="status" className="flex flex-col gap-2">
      <p className="text-body-lg">{label}</p>
      <progress
        className="h-2 w-full"
        max={run.total || undefined}
        value={run.phase === 'outline' ? undefined : run.done}
      />
    </div>
  )
}

function Review({
  team,
  run,
  draft,
  onDone,
}: {
  team: ManagedTeam
  run: Generation
  draft: Draft
  onDone: () => unknown
}) {
  const client = useQueryClient()
  const [skip, setSkip] = useState<ReadonlySet<string>>(new Set())
  const [owners, setOwners] = useState<Record<string, string | null>>({})
  const toggle = (id: string, on: boolean) =>
    setSkip((prev) => {
      const next = new Set(prev)
      if (on) next.delete(id)
      else next.add(id)
      return next
    })

  const approve = useMutation({
    mutationFn: () =>
      approveDraft({
        teamId: team.id,
        runId: run.id,
        skip: [...skip],
        owners,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['manage', team.slug] })
      return onDone()
    },
  })
  const discard = useMutation({
    mutationFn: () => discardDraft({ teamId: team.id, runId: run.id }),
    onSuccess: onDone,
  })

  const [current, setCurrent] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const sections = draft.sections
  const section = sections[current]!
  const last = current === sections.length - 1

  const kept = sections
    .flatMap((s) => s.points)
    .filter((p) => !skip.has(p.code))
  const questions = kept.reduce(
    (n, p) =>
      n + p.questions.filter((_, i) => !skip.has(`${p.code}#${i}`)).length,
    0,
  )
  const keptIn = (s: Draft['sections'][number]) =>
    s.points.filter((p) => !skip.has(p.code)).length

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Secciones del borrador"
        className="-mx-1 flex gap-2 overflow-x-auto px-1"
      >
        {sections.map((s, i) => (
          <Chip
            key={s.number}
            role="tab"
            className="h-11 shrink-0 px-3 sm:h-9"
            selected={i === current}
            onClick={() => setCurrent(i)}
          >
            {s.number}. {s.title}
            <span className="ml-2 text-meta tabular-nums text-muted">
              {keptIn(s)}/{s.points.length}
            </span>
          </Chip>
        ))}
      </div>

      <div role="tabpanel">
        <SectionTransition id={String(section.number)}>
          <ul className="flex flex-col gap-3">
            {section.points.map((p) => {
              const on = !skip.has(p.code)
              const owner = Object.hasOwn(owners, p.code)
                ? owners[p.code]
                : p.owner
              return (
                <li
                  key={p.code}
                  className="flex flex-col gap-3 rounded-card bg-surface-2 p-4"
                >
                  <div className="flex flex-wrap items-start gap-3">
                    <label className="flex min-w-0 flex-1 items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 size-4"
                        checked={on}
                        onChange={(e) => toggle(p.code, e.target.checked)}
                      />
                      <span className="flex flex-col">
                        <b className="text-body-lg">{p.title}</b>
                        <span className="text-meta text-muted">
                          Punto {p.code}
                          {p.status === 'fill' && ' · Falta completar'}
                        </span>
                      </span>
                    </label>
                    <label className="flex items-center gap-2 text-body text-muted">
                      Responsable
                      <select
                        className="h-11 rounded-control border border-border bg-bg px-2 text-body text-text sm:h-8"
                        value={owner ?? ''}
                        disabled={!on}
                        onChange={(e) =>
                          setOwners({
                            ...owners,
                            [p.code]: e.target.value || null,
                          })
                        }
                      >
                        <option value="">Nadie</option>
                        {team.identities.map((i) => (
                          <option key={i.key} value={i.key}>
                            {i.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {on ? (
                    <>
                      {p.script && <p className="text-body">{p.script}</p>}
                      {p.todo && p.status === 'fill' && (
                        <p className="text-meta text-muted">{p.todo}</p>
                      )}
                      {p.questions.length > 0 && (
                        <ul className="flex flex-col gap-2 border-t border-border pt-3">
                          {p.questions.map((q, i) => (
                            <li key={i}>
                              <label className="flex gap-3">
                                <input
                                  type="checkbox"
                                  className="mt-1 size-4"
                                  checked={!skip.has(`${p.code}#${i}`)}
                                  onChange={(e) =>
                                    toggle(`${p.code}#${i}`, e.target.checked)
                                  }
                                />
                                <span className="flex flex-col gap-1">
                                  <b className="text-body">{q.prompt}</b>
                                  <span className="text-body text-muted">
                                    {q.modelAnswer}
                                  </span>
                                  <span className="text-meta text-muted">
                                    “{q.evidence}” · {q.path}
                                  </span>
                                </span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : (
                    <p className="text-body text-muted">
                      Este punto queda afuera.
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </SectionTransition>
      </div>

      <Err>{approve.error?.message ?? discard.error?.message}</Err>
      <div className="flex flex-wrap items-center gap-2">
        {current > 0 && (
          <Button size="lg" onClick={() => setCurrent(current - 1)}>
            Sección anterior
          </Button>
        )}
        {last ? (
          <Button
            variant="primary"
            size="lg"
            disabled={kept.length === 0 || approve.isPending}
            onClick={() => approve.mutate()}
          >
            {approve.isPending
              ? 'Aprobando…'
              : `Aprobar ${kept.length} ${kept.length === 1 ? 'punto' : 'puntos'} y ${questions} ${questions === 1 ? 'pregunta' : 'preguntas'}`}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            onClick={() => setCurrent(current + 1)}
          >
            Siguiente sección
          </Button>
        )}
        <Button
          size="lg"
          variant="danger"
          className="ml-auto"
          disabled={approve.isPending}
          onClick={() => setConfirming(true)}
        >
          Descartar borrador
        </Button>
        <Dialog
          open={confirming}
          onClose={() => setConfirming(false)}
          title="¿Descartar el borrador?"
          closeLabel="Cerrar"
        >
          <p className="text-body-lg text-muted">
            Se pierde lo que revisaste. Podés generar otro borrador cuando
            quieras.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="lg" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button
              size="lg"
              variant="danger"
              disabled={discard.isPending}
              onClick={() => discard.mutate()}
            >
              Descartar
            </Button>
          </div>
        </Dialog>
      </div>
    </div>
  )
}
