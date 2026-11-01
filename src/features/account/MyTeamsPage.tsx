import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Button, Field } from '@wefaber/ui'
import { Settings } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { Visibility } from '../../../shared/types'
import { FormField, IssueSummary } from '../../components/FormField'
import { VisibilityField } from '../../components/VisibilityField'
import {
  acceptInvite,
  createTeam,
  meQuery,
  myTeamsQuery,
} from '../../lib/account'
import { Empty } from '../practice/parts'

export function SignedOut({ next }: { next: string }) {
  return (
    <Empty>
      Para esto necesitás una cuenta.{' '}
      <Link to="/cuenta/entrar" search={{ next }} className="underline">
        Entrá o creá una
      </Link>
      .
    </Empty>
  )
}

export function MyTeamsPage() {
  const me = useQuery(meQuery)
  const teams = useQuery({ ...myTeamsQuery, enabled: !!me.data })
  const client = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<Visibility>('private')
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reverify, setReverify] = useState(false)
  const [token, setToken] = useState('')
  const [tokenError, setTokenError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () => createTeam({ name, slug: null, visibility }),
    onSuccess: async (team) => {
      await client.invalidateQueries({ queryKey: ['my-teams'] })
      await navigate({ to: '/gestion/$team', params: { team: team.slug } })
    },
    onError: (e: Error & { code?: string }) => {
      setError(e.message)
      setReverify(e.code === 'REVERIFY')
    },
  })

  const join = useMutation({
    mutationFn: () => acceptInvite(token.trim()),
    onSuccess: async (team) => {
      await client.invalidateQueries({ queryKey: ['my-teams'] })
      await navigate({ to: '/$team', params: { team: team.slug } })
    },
    onError: (e) => setTokenError(e.message),
  })

  if (me.status === 'pending')
    return <p className="text-body-lg text-muted">Cargando…</p>
  if (!me.data) return <SignedOut next="/cuenta/equipos" />

  const nameIssue =
    name.trim().length < 2 ? 'El nombre necesita al menos 2 letras.' : null
  const onCreate = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setReverify(false)
    setTouched(true)
    if (nameIssue) return document.getElementById('team-name')?.focus()
    create.mutate()
  }
  const onJoin = (e: FormEvent) => {
    e.preventDefault()
    setTokenError(null)
    if (!token.trim()) {
      setTokenError('Pegá el código de la invitación.')
      return document.getElementById('invite-token')?.focus()
    }
    join.mutate()
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1 font-semibold">Mis equipos</h1>
        <p className="max-w-prose text-body-lg text-muted">
          Hola, {me.data.displayName}. Acá dirigís o integrás equipos.
        </p>
      </header>

      <section aria-labelledby="mine" className="flex flex-col gap-3">
        <h2 id="mine" className="text-h3 font-semibold">
          Tus equipos
        </h2>
        {teams.data?.length === 0 && (
          <Empty>
            Todavía no estás en ningún equipo. Creá uno o unite con una
            invitación.
          </Empty>
        )}
        <ul className="flex flex-col gap-2">
          {teams.data?.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-3"
            >
              <span className="flex flex-col">
                <Link
                  to="/$team"
                  params={{ team: t.slug }}
                  className="text-body-lg font-medium underline"
                >
                  {t.name}
                </Link>
                <span className="text-meta text-muted">
                  {t.myRole === 'director' ? 'Dirección' : 'Integrante'} ·{' '}
                  {t.visibility === 'public' ? 'público' : 'privado'}
                </span>
              </span>
              <Link
                to="/gestion/$team"
                params={{ team: t.slug }}
                className="inline-flex h-11 items-center gap-1.5 rounded-control bg-text/8 px-3 text-body hover:bg-text/12 sm:h-8"
              >
                <Settings aria-hidden size={14} />
                Gestionar
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="new" className="flex max-w-md flex-col gap-4">
        <h2 id="new" className="text-h3 font-semibold">
          Crear un equipo
        </h2>
        <form noValidate onSubmit={onCreate} className="flex flex-col gap-4">
          <FormField
            id="team-name"
            label="Nombre del equipo"
            hint="Con él armamos la dirección: mydefense/nombre-del-equipo."
            error={touched ? nameIssue : null}
          >
            <Field
              id="team-name"
              invalid={touched && !!nameIssue}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched(true)}
            />
          </FormField>
          <VisibilityField value={visibility} onChange={setVisibility} />
          <IssueSummary
            issues={
              touched && nameIssue
                ? [{ id: 'team-name', message: nameIssue }]
                : []
            }
          />
          {error && (
            <p role="alert" className="text-body-lg text-danger">
              {error}
              {reverify && (
                <>
                  {' '}
                  <a href="/auth/github/start" className="underline">
                    Entrar con GitHub
                  </a>
                </>
              )}
            </p>
          )}
          <div>
            <Button type="submit" variant="primary" size="lg">
              {create.isPending ? 'Creando…' : 'Crear equipo'}
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="join" className="flex max-w-md flex-col gap-4">
        <h2 id="join" className="text-h3 font-semibold">
          Tengo una invitación
        </h2>
        <form noValidate onSubmit={onJoin} className="flex flex-col gap-4">
          <FormField
            id="invite-token"
            label="Código de la invitación"
            hint="Es lo que sigue a /invitacion/ en el enlace que te pasaron."
            error={tokenError}
          >
            <Field
              id="invite-token"
              autoCapitalize="none"
              invalid={!!tokenError}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </FormField>
          <div>
            <Button type="submit" size="lg">
              {join.isPending ? 'Uniéndome…' : 'Unirme'}
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}

export function InvitePage() {
  const { token } = useParams({ from: '/cuenta/invitacion/$token' })
  const me = useQuery(meQuery)
  const client = useQueryClient()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const join = useMutation({
    mutationFn: () => acceptInvite(token),
    onSuccess: async (team) => {
      await client.invalidateQueries({ queryKey: ['my-teams'] })
      await navigate({ to: '/$team', params: { team: team.slug } })
    },
    onError: (e) => setError(e.message),
  })

  if (me.status === 'pending')
    return <p className="text-body-lg text-muted">Cargando…</p>
  if (!me.data) return <SignedOut next={`/cuenta/invitacion/${token}`} />
  return (
    <section className="flex max-w-md flex-col gap-4">
      <h1 className="text-h1 font-semibold">Te invitaron a un equipo</h1>
      <p className="text-body-lg text-muted">
        Al unirte, el equipo ve tu nombre ({me.data.displayName}) y tu usuario.
        Nada más.
      </p>
      {error && (
        <p role="alert" className="text-body-lg text-danger">
          {error}
        </p>
      )}
      <div>
        <Button variant="primary" size="lg" onClick={() => join.mutate()}>
          {join.isPending ? 'Uniéndome…' : 'Unirme al equipo'}
        </Button>
      </div>
    </section>
  )
}
