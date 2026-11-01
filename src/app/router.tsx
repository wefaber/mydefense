import {
  Link,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router'
import { PracticeShell } from '../features/practice/PracticeShell'
import { TabView } from '../features/practice/TabView'
import { isTab } from '../features/practice/tabs'
import { AuthPage } from '../features/account/AuthPage'
import { InvitePage, MyTeamsPage } from '../features/account/MyTeamsPage'
import { MANAGE_AREAS, type ManageArea } from '../features/manage/areas-list'
import { ManagePage } from '../features/manage/ManagePage'
import { IdentityPage, TeamsPage } from '../features/teams/TeamPages'
import { Root } from './Root'

const rootRoute = createRootRoute({
  component: Root,
  notFoundComponent: () => (
    <p className="text-body-lg text-muted">
      No encontramos esa página.{' '}
      <Link to="/" className="underline">
        Volver al inicio
      </Link>
      .
    </p>
  ),
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: TeamsPage,
})

const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'cuenta/entrar',
  validateSearch: (s: Record<string, unknown>): { next?: string } => ({
    next:
      typeof s.next === 'string' &&
      s.next.startsWith('/') &&
      !s.next.startsWith('//')
        ? s.next
        : undefined,
  }),
  component: AuthPage,
})

const myTeamsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'cuenta/equipos',
  component: MyTeamsPage,
})

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'cuenta/invitacion/$token',
  component: InvitePage,
})

const manageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'gestion/$team',
  validateSearch: (s: Record<string, unknown>): { area?: ManageArea } => ({
    area: MANAGE_AREAS.find((a) => a === s.area),
  }),
  component: ManagePage,
})

const teamRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$team',
  component: IdentityPage,
})

const practiceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$team/$who',
  component: PracticeShell,
})

const practiceIndexRoute = createRoute({
  getParentRoute: () => practiceRoute,
  path: '/',
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/$team/$who/$tab',
      params: { ...params, tab: 'puntos' },
      replace: true,
    })
  },
})

const tabRoute = createRoute({
  getParentRoute: () => practiceRoute,
  path: '$tab',
  beforeLoad: ({ params }) => {
    if (!isTab(params.tab)) {
      throw redirect({
        to: '/$team/$who/$tab',
        params: { ...params, tab: 'puntos' },
        replace: true,
      })
    }
  },
  component: TabView,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  authRoute,
  myTeamsRoute,
  inviteRoute,
  manageRoute,
  teamRoute,
  practiceRoute.addChildren([practiceIndexRoute, tabRoute]),
])

export const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
