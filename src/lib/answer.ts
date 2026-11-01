import { queryOptions } from '@tanstack/react-query'
import type { Grade } from '../../shared/types'
import { gql } from './graphql'

export interface Capabilities {
  grading: boolean
  voice: boolean
}

/** What the server has configured: without a model the practice stays self-graded. */
export const capabilitiesQuery = queryOptions({
  queryKey: ['capabilities'],
  queryFn: async () =>
    (
      await gql<{ capabilities: Capabilities }>(
        `{ capabilities { grading voice } }`,
      )
    ).capabilities,
  staleTime: 5 * 60_000,
})

export const CRITERIA_LABELS = {
  content: 'Contenido',
  terminology: 'Vocabulario técnico',
  structure: 'Orden y claridad',
} as const

export interface Grading {
  verdict: Grade
  criteria: Record<keyof typeof CRITERIA_LABELS, number>
  covered: string[]
  missing: string[]
  unsupported: string[]
  feedback: string
  delivery: {
    words: number
    wpm: number | null
    fillers: { word: string; count: number }[]
  } | null
}

export const gradeAnswer = (v: {
  teamSlug: string
  questionId: string
  answer: string
  spokenMs: number | null
}) =>
  gql<{ gradeAnswer: Grading }>(
    `mutation ($teamSlug: String!, $questionId: ID!, $answer: String!, $spokenMs: Int) {
      gradeAnswer(teamSlug: $teamSlug, questionId: $questionId, answer: $answer, spokenMs: $spokenMs) {
        verdict
        criteria { content terminology structure }
        covered missing unsupported feedback
        delivery { words wpm fillers { word count } }
      }
    }`,
    v,
  ).then((d) => d.gradeAnswer)

export const voiceToken = () =>
  gql<{ voiceToken: { token: string; version: string } }>(
    `mutation { voiceToken { token version } }`,
  ).then((d) => d.voiceToken)
