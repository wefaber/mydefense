import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { Chip, SectionTransition } from '@wefaber/ui'
import { meQuery } from '../../lib/account'
import { manageQuery, roleQuery } from '../../lib/manage'
import { SignedOut } from '../account/MyTeamsPage'
import { Empty } from '../practice/parts'
import {
  IdentitiesArea,
  MaterialsArea,
  MembersArea,
  SettingsArea,
} from './areas'

const AREAS = [
  ['identidades', 'Identidades', IdentitiesArea],
  ['personas', 'Personas', MembersArea],
  ['materiales', 'Materiales', MaterialsArea],
  ['ajustes', 'Ajustes', SettingsArea],
] as const

export function ManagePage() {
  const { team: slug } = useParams({ from: '/gestion/$team' })
  const me = useQuery(meQuery)
  const role = useQuery({ ...roleQuery(slug), enabled: !!me.data })
  const director = role.data?.myRole === 'director'
  const full = useQuery({
    ...manageQuery(slug, director),
    enabled: !!role.data?.myRole,
  })
  const area = useSearch({ from: '/gestion/$team' }).area ?? 'identidades'
  const navigate = useNavigate()

  if (me.status === 'pending')
    return <p className="text-body-lg text-muted">Cargando…</p>
  if (!me.data) return <SignedOut next={`/gestion/${slug}`} />
  if (role.status === 'error') {
    return (
      <Empty>
        No encontramos ese equipo, o no sos parte de él.{' '}
        <Link to="/cuenta/equipos" className="underline">
          Volver a mis equipos
        </Link>
      </Empty>
    )
  }
  if (role.data && !role.data.myRole) {
    return (
      <Empty>
        Solo las personas del equipo lo gestionan.{' '}
        <Link to="/$team" params={{ team: slug }} className="underline">
          Ir a practicar
        </Link>
      </Empty>
    )
  }
  if (!full.data) {
    return full.status === 'error' ? (
      <Empty>No se pudo cargar el equipo ({full.error.message}).</Empty>
    ) : (
      <p className="text-body-lg text-muted">Cargando…</p>
    )
  }

  const team = full.data
  const Current = (AREAS.find(([id]) => id === area) ?? AREAS[0])[2]
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link
          to="/cuenta/equipos"
          className="text-body-lg text-muted underline"
        >
          Mis equipos
        </Link>
        <h1 className="text-h1 font-semibold">{team.name}</h1>
        <p className="text-body-lg text-muted">
          {director ? 'Sos parte de la dirección.' : 'Sos integrante.'}{' '}
          <Link to="/$team" params={{ team: team.slug }} className="underline">
            Practicar
          </Link>
        </p>
      </header>
      <div className="sticky top-0 z-10 -mx-4 border-b border-border bg-bg/95 px-4 py-2 backdrop-blur">
        <div
          role="tablist"
          aria-label="Áreas"
          className="-mx-1 flex gap-2 overflow-x-auto px-1"
        >
          {AREAS.map(([id, label]) => (
            <Chip
              key={id}
              role="tab"
              className="h-11 px-3 sm:h-9"
              selected={area === id}
              onClick={() =>
                void navigate({
                  to: '/gestion/$team',
                  params: { team: slug },
                  search: { area: id },
                  replace: true,
                })
              }
            >
              {label}
            </Chip>
          ))}
        </div>
      </div>
      <div role="tabpanel">
        <SectionTransition id={area}>
          <Current team={team} director={director} me={me.data.id} />
        </SectionTransition>
      </div>
    </div>
  )
}
