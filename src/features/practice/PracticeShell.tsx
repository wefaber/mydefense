import { useQuery } from '@tanstack/react-query'
import { Link, Outlet, useNavigate, useParams } from '@tanstack/react-router'
import { Chip, SectionTransition } from '@wefaber/ui'
import { practiceQuery } from '../../lib/queries'
import { setWho, useProgress } from '../../lib/progress'
import { useEffect } from 'react'
import { PracticeContext } from './context'
import { TABS } from './tabs'
import { Empty } from './parts'

export function PracticeShell() {
  const { team: slug, who, tab } = useParams({ strict: false })
  const navigate = useNavigate()
  const { data: team, status, error } = useQuery(practiceQuery(slug ?? ''))
  const progress = useProgress(slug ?? '')
  const me = team?.identities.find((i) => i.key === who)

  // Remember who practiced last, so the next visit can offer it first.
  useEffect(() => {
    if (slug && me && progress.who !== me.key) setWho(slug, me.key)
  }, [slug, me, progress.who])

  if (status === 'pending') {
    return <p className="text-body-lg text-muted">Cargando…</p>
  }
  if (status === 'error') {
    return (
      <Empty>
        No se pudo cargar el equipo ({error.message}). Recargá la página.
      </Empty>
    )
  }
  const defense = team.defense
  if (!me || !defense) {
    return (
      <Empty>
        No encontramos esa identidad.{' '}
        <Link to="/$team" params={{ team: team.slug }} className="underline">
          Elegí otra
        </Link>
        .
      </Empty>
    )
  }

  const mine = defense.points.filter((p) => p.ownerId === me.id)
  const mastered = mine.filter(
    (p) => progress.ratings[`${me.key}|${p.code}`] === 2,
  ).length
  const half = mine.filter(
    (p) => progress.ratings[`${me.key}|${p.code}`] === 1,
  ).length
  const percent = mine.length ? Math.round((mastered / mine.length) * 100) : 0

  return (
    <PracticeContext value={{ team, defense, me }}>
      <div className="sticky top-0 z-10 -mx-4 flex flex-col gap-3 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur">
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Quién practica"
        >
          {team.identities.map((i) => (
            <Link
              key={i.id}
              to="/$team/$who/$tab"
              params={{ team: team.slug, who: i.key, tab: tab ?? 'puntos' }}
              aria-current={i.key === me.key ? 'true' : undefined}
              className={`inline-flex h-7 items-center rounded-control px-2.5 font-mono text-meta ${
                i.key === me.key
                  ? 'bg-accent text-on-accent'
                  : 'bg-text/8 text-text hover:bg-text/12'
              }`}
            >
              {i.name}
            </Link>
          ))}
        </div>
        <p className="text-body-lg text-muted">
          {me.role}. {me.sectors}. {mine.length} puntos: {mastered} dominados,{' '}
          {half} a medias.
        </p>
        <div
          role="progressbar"
          aria-label="Puntos dominados"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1.5 overflow-hidden rounded-full bg-surface-3"
        >
          <div
            className="h-full bg-accent transition-[width] duration-(--dur-layout)"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div
          role="tablist"
          aria-label="Secciones"
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
        >
          {TABS.map(([id, label]) => (
            <Chip
              key={id}
              role="tab"
              selected={tab === id}
              className="h-9 px-3"
              onClick={() => {
                void navigate({
                  to: '/$team/$who/$tab',
                  params: { team: team.slug, who: me.key, tab: id },
                })
                window.scrollTo(0, 0)
              }}
            >
              {label}
            </Chip>
          ))}
        </div>
      </div>
      <div className="pt-6" role="tabpanel">
        <SectionTransition id={tab ?? 'puntos'} lift>
          <Outlet />
        </SectionTransition>
      </div>
    </PracticeContext>
  )
}
