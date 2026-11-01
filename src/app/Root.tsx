import { Link, Outlet } from '@tanstack/react-router'
import { BackToTop } from '@wefaber/ui'
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react'

export function Root() {
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation}>
        <div className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col px-4">
          <header className="flex items-center justify-between py-4">
            <Link to="/" className="text-h3 font-semibold">
              MyDefense
            </Link>
            <span className="text-meta text-muted">
              Sin cuenta, sin rastros
            </span>
          </header>
          <main className="flex-1 pb-16">
            <Outlet />
          </main>
          <footer className="border-t border-border py-4 text-meta text-muted">
            Tu progreso se guarda solo en este navegador. WeFaber.
          </footer>
        </div>
        <BackToTop />
      </LazyMotion>
    </MotionConfig>
  )
}
