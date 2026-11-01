// Tests for `src/lib/simulacro.ts` (pure). They live here because only the server tsconfig carries the bun test types.
import { expect, test } from 'bun:test'
import type { Grading } from '../src/lib/answer'
import { buildRun, recapAnswers, summarize } from '../src/lib/simulacro'

const points = [
  { id: 'p1', ownerId: 'me' },
  { id: 'p2', ownerId: 'ana' },
  { id: 'p3', ownerId: 'me' },
  { id: 'p4', ownerId: 'me' },
  { id: 'p5', ownerId: 'ana' },
]
const q = (id: string, pointId: string) => ({
  id,
  pointId,
  prompt: id,
  modelAnswer: '',
  source: '',
})
const questions = [
  q('a1', 'p1'),
  q('a2', 'p1'),
  q('b1', 'p2'),
  q('c1', 'p3'),
  q('d1', 'p4'),
  q('e1', 'p5'),
]

test('a run starts with my own points in presentation order, then cross questions', () => {
  const run = buildRun(points, questions, 'me', 5, () => 0)
  const own = run.filter((x) => ['p1', 'p3', 'p4'].includes(x.pointId!))
  expect(run.slice(0, own.length).map((x) => x.pointId)).toEqual([
    'p1',
    'p3',
    'p4',
  ])
  expect(
    run
      .slice(own.length)
      .map((x) => x.pointId)
      .toSorted(),
  ).toEqual(['p2', 'p5'])
})

test('one question per own point, no repeats, and never more than asked for', () => {
  const run = buildRun(points, questions, 'me', 3, () => 0.5)
  expect(run.length).toBeLessThanOrEqual(3)
  expect(new Set(run.map((x) => x.id)).size).toBe(run.length)
  expect(run.filter((x) => x.pointId === 'p1')).toHaveLength(1)
})

test('with few cross questions the run is just shorter', () => {
  const run = buildRun(points, questions, 'me', 12, () => 0)
  expect(run).toHaveLength(5)
})

const grading = (over: Partial<Grading>): Grading => ({
  answer: 'una respuesta',
  note: '',
  verdict: 'partial',
  criteria: { content: 2, terminology: 2, structure: 2 },
  covered: [],
  missing: [],
  unsupported: [],
  feedback: '',
  confidence: 'medium',
  referenceIssue: '',
  argument: '',
  sources: [],
  consulted: 0,
  delivery: null,
  ...over,
})

test('summarize counts verdicts, averages criteria and ignores skipped answers', () => {
  const s = summarize([
    {
      question: q('a', 'p1'),
      grading: grading({
        verdict: 'complete',
        criteria: { content: 4, terminology: 3, structure: 3 },
        delivery: { words: 40, wpm: 120, fillers: [{ word: 'eh', count: 2 }] },
      }),
    },
    {
      question: q('b', 'p2'),
      grading: grading({
        verdict: 'insufficient',
        criteria: { content: 0, terminology: 1, structure: 1 },
        delivery: { words: 10, wpm: 100, fillers: [] },
      }),
    },
    { question: q('c', 'p3'), grading: null },
  ])
  expect(s.total).toBe(3)
  expect(s.graded).toBe(2)
  expect(s.byVerdict).toEqual({ complete: 1, partial: 0, insufficient: 1 })
  expect(s.criteria).toEqual({ content: 2, terminology: 2, structure: 2 })
  expect(s.wpm).toBe(110)
  expect(s.fillers).toBe(2)
})

test('summarize of nothing is all zeros, not NaN', () => {
  const s = summarize([])
  expect(s.criteria).toEqual({ content: 0, terminology: 0, structure: 0 })
  expect(s.wpm).toBeNull()
})

test('the recap input keeps the verdict and what it hung on, never the student wording', () => {
  const [first, skipped] = recapAnswers([
    {
      question: q('a', 'p1'),
      grading: grading({
        answer: 'mi respuesta textual',
        feedback: 'texto para el estudiante',
        sources: [],
        verdict: 'partial',
        covered: ['resiste GPU'],
        missing: ['firma'],
        delivery: { words: 40, wpm: 120, fillers: [{ word: 'eh', count: 2 }] },
      }),
    },
    { question: q('b', 'p2'), grading: null },
  ])
  expect(first?.question).toBe('a')
  expect(first?.grading).toEqual({
    verdict: 'partial',
    criteria: { content: 2, terminology: 2, structure: 2 },
    covered: ['resiste GPU'],
    missing: ['firma'],
    unsupported: [],
    referenceIssue: '',
    argument: '',
    delivery: { wpm: 120, fillers: [{ word: 'eh', count: 2 }] },
  })
  expect(JSON.stringify(first)).not.toContain('mi respuesta textual')
  expect(skipped?.grading).toBeNull()
})
