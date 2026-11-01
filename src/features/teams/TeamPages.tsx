import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { Empty } from '../practice/parts'
import { useProgress } from '../../lib/progress'
import { practiceQuery, teamsQuery } from '../../lib/queries'

const tileClass =
  'group flex min-h-11 items-center justify-between gap-4 rounded-tile border border-border bg-surface p-tile transition-colors duration-(--dur-fast) hover:bg-surface-2'

export function TeamsPage() {
  const { data, status, error } = useQuery(teamsQuery)
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1 font-semibold">Elegí tu equipo</h1>
        <p className="max-w-prose text-body-lg text-muted">
          Practicá la defensa de tu proyecto. No hace falta cuenta: tu progreso
          queda en este navegador.
        </p>
      </header>
      {status === 'pending' && (
        <p className="text-body-lg text-muted">Cargando…</p>
      )}
      {status === 'error' && (
        <Empty>
          No se pudieron cargar los equipos ({error.message}). Recargá la
          página.
        </Empty>
      )}
      {data?.length === 0 && <Empty>Todavía no hay equipos públicos.</Empty>}
      <ul className="flex flex-col gap-3">
        {data?.map((t) => (
          <li key={t.slug}>
            <Link to="/$team" params={{ team: t.slug }} className={tileClass}>
              <span className="flex flex-col gap-1">
                <span className="text-h3 font-semibold">{t.name}</span>
                <span className="text-body-lg text-muted">
                  {t.identities.map((i) => i.name).join(' · ')}
                </span>
              </span>
              <ArrowRight
                aria-hidden
                className="text-muted transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function IdentityPage() {
  const { team: slug } = useParams({ from: '/$team' })
  const { data: team, status, error } = useQuery(practiceQuery(slug))
  const progress = useProgress(slug)

  if (status === 'pending')
    return <p className="text-body-lg text-muted">Cargando…</p>
  if (status === 'error') {
    return (
      <Empty>
        No se pudo cargar el equipo ({error.message}).{' '}
        <Link to="/" className="underline">
          Volver
        </Link>
      </Empty>
    )
  }
  const last = team.identities.find((i) => i.key === progress.who)
  const ordered = last
    ? [last, ...team.identities.filter((i) => i.key !== last.key)]
    : team.identities

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link to="/" className="text-body-lg text-muted underline">
          Cambiar de equipo
        </Link>
        <h1 className="text-h1 font-semibold">¿Quién sos en {team.name}?</h1>
        <p className="max-w-prose text-body-lg text-muted">
          Elegí tu identidad para ver tus puntos y las preguntas que te tocan.
        </p>
      </header>
      {team.myRole && (
        <p className="text-body-lg">
          Sos{' '}
          {team.myRole === 'director' ? 'parte de la dirección' : 'integrante'}{' '}
          de este equipo.{' '}
          <Link
            to="/gestion/$team"
            params={{ team: team.slug }}
            className="underline"
          >
            Gestionar
          </Link>
        </p>
      )}
      {team.identities.length === 0 && (
        <Empty>
          Este equipo todavía no tiene identidades.
          {team.myRole === 'director'
            ? ' Agregalas desde Gestionar.'
            : ' La dirección tiene que agregarlas.'}
        </Empty>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {ordered.map((i) => (
          <li key={i.id}>
            <Link
              to="/$team/$who/$tab"
              params={{ team: team.slug, who: i.key, tab: 'puntos' }}
              className={`${tileClass} h-full`}
            >
              <span className="flex flex-col gap-1">
                <span className="text-h3 font-semibold">{i.name}</span>
                <span className="text-body-lg">{i.role}</span>
                <span className="text-meta text-muted">{i.sectors}</span>
                {i.key === last?.key && (
                  <span className="text-meta text-accent">
                    La última vez fuiste vos
                  </span>
                )}
              </span>
              <ArrowRight
                aria-hidden
                className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
