import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useQuery } from '@tanstack/react-query'
import { Link, useRouter, useSearch } from '@tanstack/react-router'
import { Button, Chip, Field } from '@wefaber/ui'
import { useState, type FormEvent } from 'react'
import { FormField, IssueSummary } from '../../components/FormField'
import {
  githubLoginQuery,
  login,
  register,
  resetSession,
} from '../../lib/account'

type Mode = 'login' | 'register'

const HANDLE = /^[a-z0-9][a-z0-9_.-]*$/i

function issuesOf(
  mode: Mode,
  v: { handle: string; displayName: string; password: string },
) {
  const issues: { id: string; message: string }[] = []
  const handle = v.handle.trim()
  if (!handle) issues.push({ id: 'handle', message: 'Falta tu usuario.' })
  else if (mode === 'register' && (handle.length < 3 || handle.length > 30)) {
    issues.push({
      id: 'handle',
      message: 'El usuario tiene entre 3 y 30 caracteres.',
    })
  } else if (mode === 'register' && !HANDLE.test(handle)) {
    issues.push({
      id: 'handle',
      message: 'El usuario va con letras, números, punto, guión o guión bajo.',
    })
  }
  if (mode === 'register' && !v.displayName.trim()) {
    issues.push({ id: 'displayName', message: 'Falta tu nombre.' })
  }
  if (!v.password)
    issues.push({ id: 'password', message: 'Falta la contraseña.' })
  else if (mode === 'register' && v.password.length < 10) {
    issues.push({
      id: 'password',
      message: 'La contraseña necesita al menos 10 caracteres.',
    })
  }
  return issues
}

export function AuthPage() {
  const { next, error } = useSearch({ from: '/cuenta/entrar' })
  const githubOrg = useQuery(githubLoginQuery).data
  const router = useRouter()
  const client = useQueryClient()
  const [mode, setMode] = useState<Mode>('login')
  const [values, setValues] = useState({
    handle: '',
    displayName: '',
    password: '',
  })
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)

  const issues = issuesOf(mode, values)
  const errorOf = (id: string) =>
    touched[id] ? (issues.find((i) => i.id === id)?.message ?? null) : null
  const touch = (id: string) => setTouched((t) => ({ ...t, [id]: true }))

  const done = () => router.history.push(next ?? '/cuenta/equipos')

  const submit = useMutation({
    mutationFn: async () => {
      if (mode === 'login') {
        await login({ handle: values.handle, password: values.password })
        return null
      }
      return (await register(values)).recoveryCodes
    },
    onSuccess: async (recoveryCodes) => {
      await resetSession(client)
      if (recoveryCodes) setCodes(recoveryCodes)
      else done()
    },
    onError: (e) => setServerError(e.message),
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setServerError(null)
    setTouched({ handle: true, displayName: true, password: true })
    const first = issues[0]
    if (first) {
      document.getElementById(first.id)?.focus()
      return
    }
    submit.mutate()
  }

  if (codes) {
    return (
      <section
        className="flex max-w-xl flex-col gap-4"
        aria-labelledby="codes-title"
      >
        <h1 id="codes-title" className="text-h1 font-semibold">
          Guardá tus códigos de recuperación
        </h1>
        <p className="text-body-lg text-muted">
          Son la única forma de entrar si olvidás la contraseña. Se muestran una
          sola vez y no guardamos tu correo ni ningún otro dato para ayudarte.
        </p>
        <ul className="grid grid-cols-2 gap-2 rounded-card border border-border bg-surface p-4 font-mono text-body-lg">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div>
          <Button variant="primary" size="lg" onClick={done}>
            Ya los guardé
          </Button>
        </div>
      </section>
    )
  }

  const isRegister = mode === 'register'
  return (
    <section
      className="flex max-w-md flex-col gap-6"
      aria-labelledby="auth-title"
    >
      <header className="flex flex-col gap-2">
        <h1 id="auth-title" className="text-h1 font-semibold">
          {isRegister ? 'Creá tu cuenta' : 'Entrá a tu cuenta'}
        </h1>
        <p className="text-body-lg text-muted">
          Para practicar no hace falta cuenta. La necesitás para crear un equipo
          o dirigirlo. No pedimos correo.
        </p>
      </header>
      {error === 'github' && (
        <p role="alert" className="text-body-lg text-danger">
          No pudimos entrar con GitHub. Probá de nuevo.
        </p>
      )}
      {githubOrg && (
        <div className="flex flex-col gap-2">
          <Button
            variant="secondary"
            size="lg"
            onClick={() => window.location.assign('/auth/github/start')}
          >
            Entrar con GitHub
          </Button>
          <p className="text-body text-muted">
            Crear equipos es para miembros de la organización {githubOrg} en
            GitHub. No pedimos correo.
          </p>
        </div>
      )}
      <div role="group" aria-label="Qué querés hacer" className="flex gap-2">
        <Chip
          className="h-11 px-3 sm:h-7"
          selected={!isRegister}
          onClick={() => setMode('login')}
        >
          Entrar
        </Chip>
        <Chip
          className="h-11 px-3 sm:h-7"
          selected={isRegister}
          onClick={() => setMode('register')}
        >
          Crear cuenta
        </Chip>
      </div>
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <FormField
          id="handle"
          label="Usuario"
          hint={
            isRegister
              ? 'Con él entrás y te encuentran en los equipos.'
              : undefined
          }
          error={errorOf('handle')}
        >
          <Field
            id="handle"
            autoComplete="username"
            autoCapitalize="none"
            invalid={!!errorOf('handle')}
            aria-describedby={
              errorOf('handle') ? 'handle-error' : 'handle-hint'
            }
            value={values.handle}
            onChange={(e) => setValues({ ...values, handle: e.target.value })}
            onBlur={() => touch('handle')}
          />
        </FormField>
        {isRegister && (
          <FormField
            id="displayName"
            label="Tu nombre"
            hint="Es lo que ve tu equipo."
            error={errorOf('displayName')}
          >
            <Field
              id="displayName"
              autoComplete="name"
              invalid={!!errorOf('displayName')}
              value={values.displayName}
              onChange={(e) =>
                setValues({ ...values, displayName: e.target.value })
              }
              onBlur={() => touch('displayName')}
            />
          </FormField>
        )}
        <FormField
          id="password"
          label="Contraseña"
          hint={
            isRegister
              ? 'Al menos 10 caracteres. Una frase larga sirve.'
              : undefined
          }
          error={errorOf('password')}
        >
          <Field
            id="password"
            type="password"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            invalid={!!errorOf('password')}
            value={values.password}
            onChange={(e) => setValues({ ...values, password: e.target.value })}
            onBlur={() => touch('password')}
          />
        </FormField>
        <IssueSummary issues={Object.keys(touched).length ? issues : []} />
        {serverError && (
          <p role="alert" className="text-body-lg text-danger">
            {serverError}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" variant="primary" size="lg">
            {submit.isPending
              ? 'Un momento…'
              : isRegister
                ? 'Crear cuenta'
                : 'Entrar'}
          </Button>
          <Link to="/" className="text-body-lg text-muted underline">
            Seguir sin cuenta
          </Link>
        </div>
      </form>
    </section>
  )
}
