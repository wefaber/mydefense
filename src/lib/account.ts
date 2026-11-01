import { queryOptions, type QueryClient } from '@tanstack/react-query'
import type { Role, Visibility } from '../../shared/types'
import { gql } from './graphql'

export interface Me {
  id: string
  handle: string
  displayName: string
}

export interface MyTeam {
  id: string
  slug: string
  name: string
  visibility: Visibility
  myRole: Role | null
}

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: async () =>
    (await gql<{ me: Me | null }>(`{ me { id handle displayName } }`)).me,
  staleTime: 5 * 60_000,
})

/** The org whose members may create teams; null when GitHub login is off on this server. */
export const githubLoginQuery = queryOptions({
  queryKey: ['github-login'],
  queryFn: async () =>
    (
      await gql<{ capabilities: { githubOrg: string | null } }>(
        `{ capabilities { githubOrg } }`,
      )
    ).capabilities.githubOrg,
  staleTime: 5 * 60_000,
})

export const myTeamsQuery = queryOptions({
  queryKey: ['my-teams'],
  queryFn: async () =>
    (
      await gql<{ myTeams: MyTeam[] }>(
        `{ myTeams { id slug name visibility myRole } }`,
      )
    ).myTeams,
})

/** Everything team-scoped depends on who is asking: forget it all when the session changes. */
export const resetSession = (client: QueryClient) => client.resetQueries()

export const register = (v: {
  handle: string
  displayName: string
  password: string
}) =>
  gql<{ register: { user: Me; recoveryCodes: string[] } }>(
    `mutation ($handle: String!, $displayName: String!, $password: String!) {
      register(handle: $handle, displayName: $displayName, password: $password) {
        user { id handle displayName } recoveryCodes
      }
    }`,
    v,
  ).then((d) => d.register)

export const login = (v: { handle: string; password: string }) =>
  gql<{ login: Me }>(
    `mutation ($handle: String!, $password: String!) {
      login(handle: $handle, password: $password) { id handle displayName }
    }`,
    v,
  ).then((d) => d.login)

export const logout = () => gql<{ logout: boolean }>(`mutation { logout }`)

export const createTeam = (v: {
  name: string
  slug: string | null
  visibility: Visibility
}) =>
  gql<{ createTeam: MyTeam }>(
    `mutation ($name: String!, $slug: String, $visibility: Visibility!) {
      createTeam(name: $name, slug: $slug, visibility: $visibility) { id slug name visibility myRole }
    }`,
    v,
  ).then((d) => d.createTeam)

export const acceptInvite = (token: string) =>
  gql<{ acceptInvite: MyTeam }>(
    `mutation ($token: String!) { acceptInvite(token: $token) { id slug name visibility myRole } }`,
    { token },
  ).then((d) => d.acceptInvite)
