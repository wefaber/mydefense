import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { BackToTop } from '@wefaber/ui'
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react'
import { logout, meQuery, resetSession } from '../lib/account'

function AccountBar() {
  const me = useQuery(meQuery)
  const client = useQueryClient()
  const navigate = useNavigate()
  const linkClass =
    'inline-flex h-11 items-center px-2 text-body-lg text-muted hover:text-text sm:h-8'

  if (me.status === 'pending') return null
  if (!me.data) {
    return (
      <Link to="/cuenta/entrar" search={{}} className={linkClass}>
        Entrar
      </Link>
    )
  }
  return (
    <nav aria-label="Cuenta" className="flex items-center gap-1">
      <Link to="/cuenta/equipos" className={linkClass}>
        {me.data.displayName}
      </Link>
      <button
        type="button"
        className={linkClass}
        onClick={async () => {
          await logout()
          await resetSession(client)
          await navigate({ to: '/' })
        }}
      >
        Salir
      </button>
    </nav>
  )
}

export function Root() {
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation}>
        <div className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col px-4">
          <header className="flex items-center justify-between py-2">
            <Link
              to="/"
              className="inline-flex h-11 items-center text-h3 font-semibold"
            >
              MyDefense
            </Link>
            <AccountBar />
          </header>
          <main className="flex-1 pb-16">
            <Outlet />
          </main>
          <footer className="border-t border-border py-4 text-meta text-muted">
            Para practicar no hace falta cuenta: tu progreso queda en este
            navegador. WeFaber.
          </footer>
        </div>
        <BackToTop />
      </LazyMotion>
    </MotionConfig>
  )
}
