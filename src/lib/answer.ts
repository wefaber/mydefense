import { queryOptions } from '@tanstack/react-query'
import type { Grade, RecapAnswer } from '../../shared/types'
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

export interface SourceRef {
  n: number
  title: string
  path: string
  url: string | null
  kind: string
  code: string | null
  created: string | null
  closed: string | null
  snippet: string
}

export const NOTE_MAX_CHARS = 600

export interface Grading {
  answer: string
  note: string
  verdict: Grade
  criteria: Record<keyof typeof CRITERIA_LABELS, number>
  covered: string[]
  missing: string[]
  unsupported: string[]
  feedback: string
  confidence: 'high' | 'medium' | 'low'
  referenceIssue: string
  argument: string
  sources: SourceRef[]
  consulted: number
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
  note?: string
}) =>
  gql<{ gradeAnswer: Grading }>(
    `mutation ($teamSlug: String!, $questionId: ID!, $answer: String!, $spokenMs: Int, $note: String) {
      gradeAnswer(teamSlug: $teamSlug, questionId: $questionId, answer: $answer, spokenMs: $spokenMs, note: $note) {
        answer note
        verdict
        criteria { content terminology structure }
        covered missing unsupported feedback
        confidence referenceIssue argument consulted
        sources { n title path url kind code created closed snippet }
        delivery { words wpm fillers { word count } }
      }
    }`,
    v,
  ).then((d) => d.gradeAnswer)

export interface Recap {
  analysis: string
  strengths: string[]
  gaps: string[]
  conclusion: string
}

/**
 * The reasoned reading of a finished session. Null when the model could not give one: show the numbers alone.
 * With `previous` and `dispute`, the model rereads the session against the student's objection to that reading.
 */
export const recapSession = (v: {
  teamSlug: string
  answers: RecapAnswer[]
  previous?: Recap
  dispute?: string
}) =>
  gql<{ recapSession: Recap | null }>(
    `mutation ($teamSlug: String!, $answers: JSON!, $previous: JSON, $dispute: String) {
      recapSession(teamSlug: $teamSlug, answers: $answers, previous: $previous, dispute: $dispute) { analysis strengths gaps conclusion }
    }`,
    v,
  ).then((d) => d.recapSession)

export const voiceToken = () =>
  gql<{ voiceToken: { token: string; version: string } }>(
    `mutation { voiceToken { token version } }`,
  ).then((d) => d.voiceToken)
