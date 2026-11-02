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
  sources: IndexedSource[]
}

export interface IndexedSource {
  id: string
  repo: string
  folder: string
  ref: string
  fileCount: number
  chunkCount: number
  embeddedCount: number
  syncedAt: string
}

/** Invites are director-only: a plain member gets the rest of the team without them. */
const TEAM_BASE = `id slug name visibility myRole
  identities { id key name role sectors }
  members { id userId role handle displayName }
  materials { id name mime size createdAt }
  sources { id repo folder ref fileCount chunkCount embeddedCount syncedAt }`

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

/** True when this server can import org repos as team material. */
export const repoImportQuery = queryOptions({
  queryKey: ['repo-import'],
  queryFn: async () =>
    (
      await gql<{ capabilities: { repoImport: boolean } }>(
        `{ capabilities { repoImport } }`,
      )
    ).capabilities.repoImport,
  staleTime: 5 * 60_000,
})

export interface RepoImportResult {
  source: IndexedSource
  added: number
  updated: number
  removed: number
  unchanged: number
  embedderDown: boolean
}

export async function importRepoMaterial(
  slug: string,
  input: { repo: string; path: string; ref: string },
): Promise<RepoImportResult> {
  const res = await fetch(
    `/api/teams/${encodeURIComponent(slug)}/materials/import`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  const body = (await res.json().catch(() => null)) as {
    import?: RepoImportResult
    error?: { message?: string }
  } | null
  if (!res.ok || !body?.import) {
    throw new Error(
      body?.error?.message ?? `No se pudo importar (HTTP ${res.status}).`,
    )
  }
  return body.import
}

export const deleteSource = (v: { teamId: string; sourceId: string }) =>
  call(
    `mutation ($teamId: ID!, $sourceId: ID!) { deleteSource(teamId: $teamId, sourceId: $sourceId) }`,
    v,
  )

export interface SearchResult {
  semantic: boolean
  hits: { id: string; path: string; text: string; score: number; via: string }[]
}

export async function searchSources(
  teamId: string,
  query: string,
): Promise<SearchResult> {
  return (
    await gql<{ searchSources: SearchResult }>(
      `query ($teamId: ID!, $query: String!) { searchSources(teamId: $teamId, query: $query) { semantic hits { id path text score via } } }`,
      { teamId, query },
    )
  ).searchSources
}

export interface RoleCandidate {
  name: string
  role: string
  sectors: string
  evidence: string
  path: string
}

export async function proposeIdentities(
  teamId: string,
): Promise<RoleCandidate[]> {
  return (
    await gql<{ proposeIdentities: RoleCandidate[] }>(
      `mutation ($teamId: ID!) { proposeIdentities(teamId: $teamId) { name role sectors evidence path } }`,
      { teamId },
    )
  ).proposeIdentities
}

export interface DraftQuestion {
  prompt: string
  modelAnswer: string
  path: string
  evidence: string
}

export interface DraftPoint {
  code: string
  title: string
  owner: string | null
  refs: string[]
  script: string
  say: string[]
  status: 'ok' | 'fill'
  todo: string
  questions: DraftQuestion[]
}

export interface Draft {
  sections: { number: number; title: string; points: DraftPoint[] }[]
}

export interface Generation {
  id: string
  status: 'running' | 'ready' | 'failed' | 'approved' | 'discarded'
  phase: string
  total: number
  done: number
  error: string
  draft: Draft | null
  createdAt: string
}

/** The latest generation of the team. Polls while it runs; directors only (null for anyone else). */
export const generationQuery = (slug: string) =>
  queryOptions({
    queryKey: ['generation', slug],
    queryFn: async () =>
      (
        await gql<{ team: { generation: Generation | null } }>(
          `query ($slug: String!) { team(slug: $slug) { generation { id status phase total done error createdAt draft } } }`,
          { slug },
        )
      ).team.generation,
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 2000 : false),
  })

export const generateDefense = (teamId: string) =>
  call<{ generateDefense: { id: string } }>(
    `mutation ($teamId: ID!) { generateDefense(teamId: $teamId) { id } }`,
    { teamId },
  )

export const approveDraft = (v: {
  teamId: string
  runId: string
  skip: string[]
  owners: Record<string, string | null>
}) =>
  call<{ approveDraft: { points: number; questions: number } }>(
    `mutation ($teamId: ID!, $runId: ID!, $skip: [String!]!, $owners: JSON!) {
      approveDraft(teamId: $teamId, runId: $runId, skip: $skip, owners: $owners) { points questions }
    }`,
    v,
  ).then((r) => r.approveDraft)

export const discardDraft = (v: { teamId: string; runId: string }) =>
  call(
    `mutation ($teamId: ID!, $runId: ID!) { discardDraft(teamId: $teamId, runId: $runId) }`,
    v,
  )
