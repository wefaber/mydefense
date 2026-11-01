import { queryOptions } from '@tanstack/react-query'
import type { Role, Visibility } from '../../shared/types'
import { gql } from './graphql'

export interface ManagedTeam {
  id: string
  slug: string
  name: string
  visibility: Visibility
  myRole: Role | null
  identities: {
    id: string
    key: string
    name: string
    role: string
    sectors: string
  }[]
  members: {
    id: string
    userId: string
    role: Role
    handle: string
    displayName: string
  }[]
  invites: { id: string; role: Role; expiresAt: string }[]
  materials: {
    id: string
    name: string
    mime: string
    size: number
    createdAt: string
  }[]
}

/** Invites are director-only: a plain member gets the rest of the team without them. */
const TEAM_BASE = `id slug name visibility myRole
  identities { id key name role sectors }
  members { id userId role handle displayName }
  materials { id name mime size createdAt }`

export const manageQuery = (slug: string, director: boolean) =>
  queryOptions({
    queryKey: ['manage', slug, director],
    queryFn: async () => {
      const { team } = await gql<{ team: ManagedTeam }>(
        `query ($slug: String!) { team(slug: $slug) { ${TEAM_BASE} ${director ? 'invites { id role expiresAt }' : ''} } }`,
        { slug },
      )
      return { ...team, invites: team.invites ?? [] }
    },
  })

/** First look: only enough to learn the role, which decides what the full query may ask for. */
export const roleQuery = (slug: string) =>
  queryOptions({
    queryKey: ['team-role', slug],
    queryFn: async () =>
      (
        await gql<{ team: { id: string; name: string; myRole: Role | null } }>(
          `query ($slug: String!) { team(slug: $slug) { id name myRole } }`,
          { slug },
        )
      ).team,
  })

const call = <T>(query: string, variables: Record<string, unknown>) =>
  gql<T>(query, variables)

export const updateTeam = (v: {
  teamId: string
  name?: string
  visibility?: Visibility
}) =>
  call(
    `mutation ($teamId: ID!, $name: String, $visibility: Visibility) {
      updateTeam(teamId: $teamId, name: $name, visibility: $visibility) { id }
    }`,
    v,
  )

export const addIdentity = (v: {
  teamId: string
  name: string
  role: string
  sectors: string
}) =>
  call(
    `mutation ($teamId: ID!, $name: String!, $role: String!, $sectors: String!) {
      addIdentity(teamId: $teamId, name: $name, role: $role, sectors: $sectors) { id }
    }`,
    v,
  )

export const updateIdentity = (v: {
  teamId: string
  identityId: string
  name: string
  role: string
  sectors: string
}) =>
  call(
    `mutation ($teamId: ID!, $identityId: ID!, $name: String, $role: String, $sectors: String) {
      updateIdentity(teamId: $teamId, identityId: $identityId, name: $name, role: $role, sectors: $sectors) { id }
    }`,
    v,
  )

export const removeIdentity = (v: { teamId: string; identityId: string }) =>
  call(
    `mutation ($teamId: ID!, $identityId: ID!) { removeIdentity(teamId: $teamId, identityId: $identityId) }`,
    v,
  )

export const createInvite = (v: { teamId: string; role: Role }) =>
  call<{ createInvite: { token: string; expiresAt: string } }>(
    `mutation ($teamId: ID!, $role: Role!) { createInvite(teamId: $teamId, role: $role) { token expiresAt } }`,
    v,
  ).then((d) => d.createInvite)

export const revokeInvite = (v: { teamId: string; inviteId: string }) =>
  call(
    `mutation ($teamId: ID!, $inviteId: ID!) { revokeInvite(teamId: $teamId, inviteId: $inviteId) }`,
    v,
  )

export const setMemberRole = (v: {
  teamId: string
  memberId: string
  role: Role
}) =>
  call(
    `mutation ($teamId: ID!, $memberId: ID!, $role: Role!) { setMemberRole(teamId: $teamId, memberId: $memberId, role: $role) }`,
    v,
  )

export const removeMember = (v: { teamId: string; memberId: string }) =>
  call(
    `mutation ($teamId: ID!, $memberId: ID!) { removeMember(teamId: $teamId, memberId: $memberId) }`,
    v,
  )

export const deleteMaterial = (v: { teamId: string; materialId: string }) =>
  call(
    `mutation ($teamId: ID!, $materialId: ID!) { deleteMaterial(teamId: $teamId, materialId: $materialId) }`,
    v,
  )

export async function uploadMaterial(slug: string, file: File): Promise<void> {
  const form = new FormData()
  form.set('file', file)
  const res = await fetch(`/api/teams/${encodeURIComponent(slug)}/materials`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string }
    } | null
    throw new Error(
      body?.error?.message ?? `No se pudo subir (HTTP ${res.status}).`,
    )
  }
}
