import { queryOptions } from '@tanstack/react-query'
import type { PointStatus } from '../../shared/types'
import { gql } from './graphql'

export interface Identity {
  id: string
  key: string
  name: string
  role: string
  sectors: string
}

export interface TeamSummary {
  slug: string
  name: string
  identities: { id: string; name: string }[]
}

export interface Section {
  id: string
  number: number
  title: string
}

export interface Point {
  id: string
  code: string
  title: string
  script: string
  say: string[]
  refs: string[]
  status: PointStatus
  todo: string
  ownerId: string | null
  sectionId: string
}

export interface Question {
  id: string
  pointId: string | null
  prompt: string
  modelAnswer: string
  source: string
  extra: Record<string, unknown>
}

export interface Resource {
  id: string
  title: string
  body: Record<string, unknown>
}

export interface Practice {
  id: string
  slug: string
  name: string
  identities: Identity[]
  defense: {
    title: string
    date: string
    criteria: { name: string; description: string }[]
    sections: Section[]
    points: Point[]
    pointQuestions: Question[]
    bank: Question[]
    topicQuestions: Question[]
    lessons: Resource[]
    exercises: Resource[]
    pending: Resource[]
    facts: Resource[]
  } | null
}

const TEAMS = `{ teams { slug name identities { id name } } }`

const PRACTICE = `query Practice($slug: String!) {
  team(slug: $slug) {
    id slug name
    identities { id key name role sectors }
    defense {
      title date
      criteria { name description }
      sections { id number title }
      points { id code title script say refs status todo ownerId sectionId }
      pointQuestions: questions(group: point) { id pointId prompt modelAnswer source extra }
      bank: questions(group: bank) { id pointId prompt modelAnswer source extra }
      topicQuestions: questions(group: topic) { id pointId prompt modelAnswer source extra }
      lessons: resources(kind: lesson) { id title body }
      exercises: resources(kind: exercise) { id title body }
      pending: resources(kind: pending) { id title body }
      facts: resources(kind: fact) { id title body }
    }
  }
}`

export const teamsQuery = queryOptions({
  queryKey: ['teams'],
  queryFn: async () => (await gql<{ teams: TeamSummary[] }>(TEAMS)).teams,
})

export const practiceQuery = (slug: string) =>
  queryOptions({
    queryKey: ['practice', slug],
    queryFn: async () =>
      (await gql<{ team: Practice }>(PRACTICE, { slug })).team,
  })
