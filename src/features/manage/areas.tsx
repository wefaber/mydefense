import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Chip, Field } from '@wefaber/ui'
import {
  Copy,
  GitBranch,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import type { Role, Visibility } from '../../../shared/types'
import { FormField } from '../../components/FormField'
import { VisibilityField } from '../../components/VisibilityField'
import {
  addIdentity,
  createInvite,
  deleteMaterial,
  deleteSource,
  proposeIdentities,
  type RoleCandidate,
  importRepoMaterial,
  removeIdentity,
  removeMember,
  repoImportQuery,
  revokeInvite,
  searchSources,
  setMemberRole,
  updateIdentity,
  updateTeam,
  uploadMaterial,
  type ManagedTeam,
} from '../../lib/manage'
import { Empty } from '../practice/parts'

interface AreaProps {
  team: ManagedTeam
  director: boolean
  me: string
}

/** Runs a mutation, refreshes the team and shows the error next to the action. */
function useAction<V, R>(fn: (v: V) => Promise<R>, slug: string) {
  const client = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: fn,
    onMutate: () => setError(null),
    onSuccess: () => client.invalidateQueries({ queryKey: ['manage', slug] }),
    onError: (e) => setError(e.message),
  })
  return { ...mutation, error }
}

const Err = ({ children }: { children: string | null }) =>
  children ? (
    <p role="alert" className="text-body-lg text-danger">
      {children}
    </p>
  ) : null

const ghostBtn =
  'inline-flex h-11 items-center gap-1.5 rounded-control px-3 text-body hover:bg-text/8 disabled:opacity-50 sm:h-8'

const iconBtn =
  'inline-flex h-11 items-center gap-1.5 rounded-control px-3 text-body text-danger hover:bg-text/8 sm:h-8'

/* --- Identidades ------------------------------------------------------------------------------------------------ */

export function IdentitiesArea({ team, director }: AreaProps) {
  const add = useAction(addIdentity, team.slug)
  const edit = useAction(updateIdentity, team.slug)
  const remove = useAction(removeIdentity, team.slug)
  const [draft, setDraft] = useState({ name: '', role: '', sectors: '' })
  const [touched, setTouched] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [patch, setPatch] = useState({ name: '', role: '', sectors: '' })

  const onAdd = (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!draft.name.trim())
      return document.getElementById('identity-name')?.focus()
    add.mutate(
      { teamId: team.id, ...draft },
      {
        onSuccess: () => {
          setDraft({ name: '', role: '', sectors: '' })
          setTouched(false)
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-prose text-body-lg text-muted">
        Una identidad es quién presenta. Cada integrante del equipo practica
        eligiendo una.
      </p>
      {team.identities.length === 0 && (
        <Empty>Todavía no hay identidades. Agregá la primera.</Empty>
      )}
      <ul className="flex flex-col gap-2">
        {team.identities.map((i) => (
          <li
            key={i.id}
            className="rounded-card border border-border bg-surface px-4 py-3"
          >
            {editing === i.id ? (
              <form
                noValidate
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  edit.mutate(
                    { teamId: team.id, identityId: i.id, ...patch },
                    { onSuccess: () => setEditing(null) },
                  )
                }}
              >
                <Field
                  aria-label="Nombre"
                  value={patch.name}
                  onChange={(e) => setPatch({ ...patch, name: e.target.value })}
                />
                <Field
                  aria-label="Rol"
                  value={patch.role}
                  onChange={(e) => setPatch({ ...patch, role: e.target.value })}
                />
                <Field
                  aria-label="Sectores"
                  value={patch.sectors}
                  onChange={(e) =>
                    setPatch({ ...patch, sectors: e.target.value })
                  }
                />
                <Err>{edit.error}</Err>
                <div className="flex gap-2">
                  <Button type="submit" variant="primary">
                    Guardar
                  </Button>
                  <Button onClick={() => setEditing(null)}>Cancelar</Button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <span className="flex flex-col">
                  <b className="text-body-lg">{i.name}</b>
                  <span className="text-body-lg">{i.role}</span>
                  <span className="text-meta text-muted">{i.sectors}</span>
                </span>
                {director && (
                  <span className="flex gap-1">
                    <Button
                      onClick={() => {
                        setEditing(i.id)
                        setPatch({
                          name: i.name,
                          role: i.role,
                          sectors: i.sectors,
                        })
                      }}
                    >
                      Editar
                    </Button>
                    <button
                      type="button"
                      className={iconBtn}
                      onClick={() => {
                        if (
                          confirm(
                            `¿Quitar a ${i.name}? Sus puntos quedan sin presentador.`,
                          )
                        ) {
                          remove.mutate({ teamId: team.id, identityId: i.id })
                        }
                      }}
                    >
                      <Trash2 aria-hidden size={14} />
                      Quitar
                    </button>
                  </span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      <Err>{remove.error}</Err>
      {director && team.sources.length > 0 && <RolesFromMaterial team={team} />}
      {director && (
        <form
          noValidate
          onSubmit={onAdd}
          className="flex max-w-md flex-col gap-4"
        >
          <h3 className="text-h3 font-semibold">Agregar identidad</h3>
          <FormField
            id="identity-name"
            label="Nombre"
            error={touched && !draft.name.trim() ? 'Falta el nombre.' : null}
          >
            <Field
              id="identity-name"
              invalid={touched && !draft.name.trim()}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </FormField>
          <FormField
            id="identity-role"
            label="Rol"
            hint="Por ejemplo: Coordinador o Miembro."
          >
            <Field
              id="identity-role"
              value={draft.role}
              onChange={(e) => setDraft({ ...draft, role: e.target.value })}
            />
          </FormField>
          <FormField
            id="identity-sectors"
            label="Sectores"
            hint="De qué se encarga en el proyecto."
          >
            <Field
              id="identity-sectors"
              value={draft.sectors}
              onChange={(e) => setDraft({ ...draft, sectors: e.target.value })}
            />
          </FormField>
          <Err>{add.error}</Err>
          <div>
            <Button type="submit" variant="primary" size="lg">
              Agregar
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

/* --- Miembros e invitaciones ------------------------------------------------------------------------------------- */

export function MembersArea({ team, director, me }: AreaProps) {
  const role = useAction(setMemberRole, team.slug)
  const remove = useAction(removeMember, team.slug)
  const invite = useAction(createInvite, team.slug)
  const revoke = useAction(revokeInvite, team.slug)
  const [inviteRole, setInviteRole] = useState<Role>('member')
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const makeInvite = () =>
    invite.mutate(
      { teamId: team.id, role: inviteRole },
      {
        onSuccess: (data) => {
          setCopied(false)
          setLink(`${location.origin}/cuenta/invitacion/${data.token}`)
        },
      },
    )

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3" aria-labelledby="members-title">
        <h2 id="members-title" className="text-h3 font-semibold">
          Personas del equipo
        </h2>
        <ul className="flex flex-col gap-2">
          {team.members.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-3"
            >
              <span className="flex flex-col">
                <b className="text-body-lg">{m.displayName}</b>
                <span className="text-meta text-muted">
                  @{m.handle} ·{' '}
                  {m.role === 'director' ? 'Dirección' : 'Integrante'}
                  {m.userId === me ? ' · vos' : ''}
                </span>
              </span>
              <span className="flex flex-wrap gap-1">
                {director && (
                  <Button
                    onClick={() =>
                      role.mutate({
                        teamId: team.id,
                        memberId: m.id,
                        role: m.role === 'director' ? 'member' : 'director',
                      })
                    }
                  >
                    {m.role === 'director'
                      ? 'Pasar a integrante'
                      : 'Hacer dirección'}
                  </Button>
                )}
                {(director || m.userId === me) && (
                  <button
                    type="button"
                    className={iconBtn}
                    onClick={() => {
                      const self = m.userId === me
                      if (
                        confirm(
                          self
                            ? '¿Salir del equipo?'
                            : `¿Sacar a ${m.displayName} del equipo?`,
                        )
                      ) {
                        remove.mutate({ teamId: team.id, memberId: m.id })
                      }
                    }}
                  >
                    <Trash2 aria-hidden size={14} />
                    {m.userId === me ? 'Salir' : 'Sacar'}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
        <Err>{role.error ?? remove.error}</Err>
      </section>

      {director && (
        <section
          className="flex max-w-xl flex-col gap-3"
          aria-labelledby="invite-title"
        >
          <h2 id="invite-title" className="text-h3 font-semibold">
            Invitar
          </h2>
          <p className="text-body-lg text-muted">
            El enlace sirve una vez y vence en 7 días. Quien lo abra necesita
            una cuenta.
          </p>
          <div
            role="group"
            aria-label="Rol de la invitación"
            className="flex gap-2"
          >
            <Chip
              className="h-11 px-3 sm:h-7"
              selected={inviteRole === 'member'}
              onClick={() => setInviteRole('member')}
            >
              Integrante
            </Chip>
            <Chip
              className="h-11 px-3 sm:h-7"
              selected={inviteRole === 'director'}
              onClick={() => setInviteRole('director')}
            >
              Dirección
            </Chip>
          </div>
          <div>
            <Button variant="primary" size="lg" onClick={makeInvite}>
              {invite.isPending ? 'Creando…' : 'Crear enlace'}
            </Button>
          </div>
          <Err>{invite.error}</Err>
          {link && (
            <div className="flex flex-col gap-2 rounded-card border border-border bg-surface-2 p-3">
              <p className="text-meta text-muted">
                Copialo ahora: no lo volvemos a mostrar.
              </p>
              <div className="flex gap-2">
                <Field
                  readOnly
                  aria-label="Enlace de invitación"
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  size="lg"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(link)
                      .then(() => setCopied(true))
                  }}
                >
                  <Copy aria-hidden size={14} />
                  {copied ? 'Copiado' : 'Copiar'}
                </Button>
              </div>
            </div>
          )}
          {team.invites.length > 0 && (
            <>
              <h3 className="pt-2 text-body-lg font-semibold">
                Invitaciones abiertas
              </h3>
              <ul className="flex flex-col gap-2">
                {team.invites.map((i) => (
                  <li
                    key={i.id}
                    className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-2 text-body-lg"
                  >
                    <span>
                      {i.role === 'director' ? 'Dirección' : 'Integrante'} ·
                      vence {new Date(i.expiresAt).toLocaleDateString('es-UY')}
                    </span>
                    <button
                      type="button"
                      className={iconBtn}
                      onClick={() =>
                        revoke.mutate({ teamId: team.id, inviteId: i.id })
                      }
                    >
                      Anular
                    </button>
                  </li>
                ))}
              </ul>
              <Err>{revoke.error}</Err>
            </>
          )}
        </section>
      )}
    </div>
  )
}

/* --- Materiales -------------------------------------------------------------------------------------------------- */

const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`

export function MaterialsArea({ team }: AreaProps) {
  const client = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const remove = useAction(deleteMaterial, team.slug)
  const [error, setError] = useState<string | null>(null)
  const upload = useMutation({
    mutationFn: (file: File) => uploadMaterial(team.slug, file),
    onMutate: () => setError(null),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ['manage', team.slug] }),
    onError: (e) => setError(e.message),
  })

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-prose text-body-lg text-muted">
        Subí el material de tu proyecto (PDF, DOCX, Markdown o texto, hasta 10
        MB). Queda guardado para el equipo y todavía no se procesa: eso llega en
        la próxima etapa.
      </p>
      <div className="flex flex-col gap-2">
        <input
          ref={input}
          id="material-file"
          aria-label="Elegir archivo de material"
          type="file"
          accept=".pdf,.docx,.md,.txt"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) upload.mutate(file)
            e.target.value = ''
          }}
        />
        <div>
          <Button
            variant="primary"
            size="lg"
            onClick={() => input.current?.click()}
          >
            <Upload aria-hidden size={16} />
            {upload.isPending ? 'Subiendo…' : 'Subir archivo'}
          </Button>
        </div>
        <Err>{error}</Err>
      </div>
      <RepoImport team={team} />
      {team.materials.length === 0 && (
        <Empty>Todavía no subiste material.</Empty>
      )}
      <ul className="flex flex-col gap-2">
        {team.materials.map((m) => (
          <li
            key={m.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-3"
          >
            <span className="flex flex-col">
              <b className="text-body-lg break-all">{m.name}</b>
              <span className="text-meta text-muted tabular-nums">
                {size(m.size)}
              </span>
            </span>
            <button
              type="button"
              className={iconBtn}
              onClick={() => {
                if (confirm(`¿Borrar ${m.name}?`))
                  remove.mutate({ teamId: team.id, materialId: m.id })
              }}
            >
              <Trash2 aria-hidden size={14} />
              Borrar
            </button>
          </li>
        ))}
      </ul>
      <Err>{remove.error}</Err>
    </div>
  )
}

/** Sources: org repos indexed for search. The form shows only when the server has the import token. */
function RepoImport({ team }: { team: ManagedTeam }) {
  const client = useQueryClient()
  const enabled = useQuery(repoImportQuery).data
  const [draft, setDraft] = useState({ repo: '', path: '', ref: '' })
  const [touched, setTouched] = useState(false)
  const remove = useAction(deleteSource, team.slug)
  const run = useMutation({
    mutationFn: (v: { repo: string; path: string; ref: string }) =>
      importRepoMaterial(team.slug, v),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ['manage', team.slug] }),
  })
  if (!enabled && team.sources.length === 0) return null

  const missing = !draft.repo.trim()
  const result = run.data
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h3 className="text-h3 font-semibold">Fuentes de GitHub</h3>
        <p className="max-w-prose text-body-lg text-muted">
          Indexamos los archivos Markdown y de texto de un repo de la
          organización, para buscar en ellos por palabras y por significado.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {team.sources.map((s) => (
          <li
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-3"
          >
            <span className="flex flex-col">
              <b className="text-body-lg break-all">
                {s.repo}
                {s.folder && `/${s.folder}`}
                {s.ref !== 'HEAD' && ` @ ${s.ref}`}
              </b>
              <span className="text-meta text-muted tabular-nums">
                {s.fileCount} archivos · {s.chunkCount} fragmentos
                {s.embeddedCount < s.chunkCount &&
                  ` · ${s.chunkCount - s.embeddedCount} sin significado`}
              </span>
            </span>
            <span className="flex gap-1">
              {enabled && (
                <button
                  type="button"
                  className={ghostBtn}
                  disabled={run.isPending}
                  onClick={() =>
                    run.mutate({
                      repo: s.repo,
                      path: s.folder,
                      ref: s.ref === 'HEAD' ? '' : s.ref,
                    })
                  }
                >
                  <RefreshCw aria-hidden size={14} />
                  Actualizar
                </button>
              )}
              <button
                type="button"
                className={iconBtn}
                onClick={() => {
                  if (confirm(`¿Quitar ${s.repo} del índice?`))
                    remove.mutate({ teamId: team.id, sourceId: s.id })
                }}
              >
                <Trash2 aria-hidden size={14} />
                Quitar
              </button>
            </span>
          </li>
        ))}
      </ul>
      <Err>{remove.error}</Err>
      {enabled && (
        <form
          noValidate
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            setTouched(true)
            if (!missing) run.mutate(draft)
          }}
          className="flex max-w-md flex-col gap-4"
        >
          <FormField
            id="import-repo"
            label="Repo"
            hint="Por ejemplo: eternum-docs."
            error={touched && missing ? 'Falta el repo.' : null}
          >
            <Field
              id="import-repo"
              invalid={touched && missing}
              value={draft.repo}
              onChange={(e) => setDraft({ ...draft, repo: e.target.value })}
            />
          </FormField>
          <FormField
            id="import-path"
            label="Carpeta (opcional)"
            hint="Por ejemplo: fuentes/defensa. Vacía, se indexa todo el repo."
          >
            <Field
              id="import-path"
              value={draft.path}
              onChange={(e) => setDraft({ ...draft, path: e.target.value })}
            />
          </FormField>
          <FormField
            id="import-ref"
            label="Rama (opcional)"
            hint="Si la dejás vacía, usa la principal."
          >
            <Field
              id="import-ref"
              value={draft.ref}
              onChange={(e) => setDraft({ ...draft, ref: e.target.value })}
            />
          </FormField>
          <div>
            <Button type="submit" variant="primary" size="lg">
              <GitBranch aria-hidden size={16} />
              {run.isPending ? 'Indexando…' : 'Indexar'}
            </Button>
          </div>
        </form>
      )}
      <Err>{run.error?.message ?? null}</Err>
      {result && (
        <p role="status" className="max-w-prose text-body-lg text-muted">
          Listo: {result.added} archivos nuevos, {result.updated} actualizados y{' '}
          {result.removed} quitados.
          {result.embedderDown &&
            ' El servicio de significado no respondió: por ahora se busca solo por palabras. Actualizá la fuente más tarde.'}
        </p>
      )}
      {team.sources.length > 0 && <SourceSearch team={team} />}
    </section>
  )
}

/** Checks what the index finds, in the words a member would type. */
function SourceSearch({ team }: { team: ManagedTeam }) {
  const [query, setQuery] = useState('')
  const search = useMutation({
    mutationFn: (q: string) => searchSources(team.id, q),
  })
  const VIA: Record<string, string> = {
    words: 'palabras',
    meaning: 'significado',
    both: 'palabras y significado',
  }
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-h3 font-semibold">Probar la búsqueda</h3>
      <form
        className="flex max-w-md items-end gap-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          if (query.trim()) search.mutate(query)
        }}
      >
        <div className="flex-1">
          <Field
            aria-label="Buscar en las fuentes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button type="submit" variant="primary" size="lg">
          <Search aria-hidden size={16} />
          Buscar
        </Button>
      </form>
      <Err>{search.error?.message ?? null}</Err>
      {search.data && search.data.hits.length === 0 && (
        <Empty>No encontramos nada con eso.</Empty>
      )}
      <ul className="flex flex-col gap-2">
        {search.data?.hits.map((h) => (
          <li
            key={h.id}
            className="flex flex-col gap-1 rounded-card border border-border bg-surface px-4 py-3"
          >
            <b className="text-body-lg break-all">{h.path}</b>
            <span className="text-body text-muted">
              {h.text.length > 280 ? `${h.text.slice(0, 280)}…` : h.text}
            </span>
            <span className="text-meta text-muted">
              Por {VIA[h.via] ?? h.via}
            </span>
          </li>
        ))}
      </ul>
      {search.data && !search.data.semantic && (
        <p className="text-meta text-muted">Búsqueda solo por palabras.</p>
      )}
    </div>
  )
}

/* --- Ajustes ----------------------------------------------------------------------------------------------------- */

export function SettingsArea({ team, director }: AreaProps) {
  const save = useAction(updateTeam, team.slug)
  const [name, setName] = useState(team.name)
  const [visibility, setVisibility] = useState<Visibility>(team.visibility)
  const [saved, setSaved] = useState(false)

  if (!director)
    return <Empty>Solo la dirección cambia los ajustes del equipo.</Empty>
  const issue =
    name.trim().length < 2 ? 'El nombre necesita al menos 2 letras.' : null
  return (
    <form
      noValidate
      className="flex max-w-md flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        setSaved(false)
        if (issue) return document.getElementById('settings-name')?.focus()
        save.mutate(
          { teamId: team.id, name, visibility },
          { onSuccess: () => setSaved(true) },
        )
      }}
    >
      <FormField id="settings-name" label="Nombre del equipo" error={issue}>
        <Field
          id="settings-name"
          invalid={!!issue}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </FormField>
      <VisibilityField value={visibility} onChange={setVisibility} />
      <Err>{save.error}</Err>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" size="lg">
          Guardar
        </Button>
        <span aria-live="polite" className="text-body-lg text-muted">
          {saved ? 'Guardado.' : ''}
        </span>
      </div>
    </form>
  )
}

/** Reads the indexed sources for the people who present. Nothing is created until the director picks. */
function RolesFromMaterial({ team }: { team: ManagedTeam }) {
  const client = useQueryClient()
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const find = useMutation({
    mutationFn: () => proposeIdentities(team.id),
    onSuccess: (found) =>
      setPicked(Object.fromEntries(found.map((c) => [c.name, true]))),
  })
  const add = useMutation({
    mutationFn: async (chosen: RoleCandidate[]) => {
      for (const c of chosen) {
        await addIdentity({
          teamId: team.id,
          name: c.name,
          role: c.role,
          sectors: c.sectors,
        })
      }
    },
    onSuccess: () => {
      find.reset()
      return client.invalidateQueries({ queryKey: ['manage', team.slug] })
    },
  })
  const found = find.data
  const chosen = found?.filter((c) => picked[c.name]) ?? []

  return (
    <section className="flex max-w-prose flex-col gap-3">
      <h3 className="text-h3 font-semibold">Sacar del material</h3>
      <p className="text-body-lg text-muted">
        Leemos las fuentes indexadas y te proponemos quién presenta y con qué
        rol. Cada propuesta lleva la cita que la respalda; revisala antes de
        agregarla.
      </p>
      <div>
        <Button
          variant="primary"
          size="lg"
          disabled={find.isPending}
          onClick={() => find.mutate()}
        >
          <Sparkles aria-hidden size={16} />
          {find.isPending ? 'Leyendo…' : 'Buscar roles en el material'}
        </Button>
      </div>
      <Err>{find.error?.message ?? add.error?.message ?? null}</Err>
      {found && found.length === 0 && (
        <Empty>
          No encontramos integrantes con claridad en el material. Agregalos a
          mano.
        </Empty>
      )}
      {found && found.length > 0 && (
        <>
          <ul className="flex flex-col gap-2">
            {found.map((c) => (
              <li
                key={c.name}
                className="flex gap-3 rounded-card border border-border bg-surface px-4 py-3"
              >
                <input
                  type="checkbox"
                  aria-label={`Agregar a ${c.name}`}
                  className="mt-1 size-4"
                  checked={!!picked[c.name]}
                  onChange={(e) =>
                    setPicked({ ...picked, [c.name]: e.target.checked })
                  }
                />
                <span className="flex flex-col gap-1">
                  <b className="text-body-lg">
                    {c.name}
                    {c.role && ` · ${c.role}`}
                  </b>
                  {c.sectors && (
                    <span className="text-body text-muted">{c.sectors}</span>
                  )}
                  <span className="text-meta text-muted">
                    “{c.evidence}” · {c.path}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div>
            <Button
              variant="primary"
              size="lg"
              disabled={chosen.length === 0 || add.isPending}
              onClick={() => add.mutate(chosen)}
            >
              {add.isPending
                ? 'Agregando…'
                : `Agregar ${chosen.length} ${chosen.length === 1 ? 'identidad' : 'identidades'}`}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
