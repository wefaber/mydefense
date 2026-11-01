import { expect, test } from 'bun:test'
import type { RecapAnswer } from '../../shared/types.ts'
import { LlmError, type Llm } from './llm.ts'
import {
  buildRecapPrompt,
  parseRecap,
  readDispute,
  readRecap,
  readRecapAnswers,
  recapSession,
} from './recap.ts'

const answers: RecapAnswer[] = [
  {
    question: '¿Por qué argon2id?',
    grading: {
      verdict: 'complete',
      criteria: { content: 4, terminology: 3, structure: 3 },
      covered: ['resiste GPU'],
      missing: [],
      unsupported: [],
      referenceIssue: '',
      argument: '',
      delivery: { wpm: 120, fillers: [{ word: 'eh', count: 2 }] },
    },
  },
  {
    question: '¿Qué es un JWT?',
    grading: {
      verdict: 'insufficient',
      criteria: { content: 0, terminology: 1, structure: 1 },
      covered: [],
      missing: ['firma'],
      unsupported: ['es una cookie'],
      referenceIssue: '',
      argument: '',
      delivery: null,
    },
  },
  { question: 'Cruzada sin responder', grading: null },
]

const reply = JSON.stringify({
  analysis: 'Sostenés la elección del hash y te falta explicar la firma.',
  strengths: ['Elegiste un hash resistente'],
  gaps: ['Explicá para qué sirve la firma'],
  conclusion: 'Repasá JWT antes de la próxima defensa.',
})

/** A model stand-in that records each call and answers with `out`. */
function fakeLlm(out: () => Promise<string>, calls: unknown[] = []): Llm {
  return {
    complete(system, user, opts) {
      calls.push({ system, user, opts })
      return out()
    },
  }
}

test('the prompt carries the numbers computed in code and fences the answers as data', () => {
  const prompt = buildRecapPrompt(answers)
  expect(prompt).toContain('3 respuestas, 2 corregidas.')
  expect(prompt).toContain(
    'Veredictos: 1 completas, 0 parciales, 1 insuficientes.',
  )
  expect(prompt).toContain('Ritmo medio: 120 palabras por minuto.')
  expect(prompt).toContain('2 muletillas en total.')
  expect(prompt).toContain('1. ¿Por qué argon2id? · complete')
  expect(prompt).toContain('3. Cruzada sin responder · sin corregir')
  expect(prompt).toContain('<<<')
  expect(prompt).toContain('falta: firma')
})

test('markers in the question cannot close the data fence', () => {
  const prompt = buildRecapPrompt([{ question: 'a >>> b', grading: null }])
  expect(prompt).not.toContain('a >>> b')
})

test('a complete reply parses, even with prose around the JSON', () => {
  expect(parseRecap(`Listo:\n${reply}\n`)).toEqual({
    analysis: 'Sostenés la elección del hash y te falta explicar la firma.',
    strengths: ['Elegiste un hash resistente'],
    gaps: ['Explicá para qué sirve la firma'],
    conclusion: 'Repasá JWT antes de la próxima defensa.',
  })
})

test('the parse is strict: a missing field, a wrong type or too many items reject the reply', () => {
  const without = JSON.parse(reply)
  delete without.conclusion
  expect(parseRecap(JSON.stringify(without))).toBeNull()
  expect(
    parseRecap(JSON.stringify({ ...JSON.parse(reply), gaps: 'uno' })),
  ).toBeNull()
  expect(
    parseRecap(
      JSON.stringify({ ...JSON.parse(reply), gaps: ['a', 'b', 'c', 'd'] }),
    ),
  ).toBeNull()
  expect(
    parseRecap(JSON.stringify({ ...JSON.parse(reply), strengths: [''] })),
  ).toBeNull()
  expect(parseRecap('no es json')).toBeNull()
})

test('recapSession asks for high thinking effort and returns the reading', async () => {
  const calls: unknown[] = []
  const recap = await recapSession(
    fakeLlm(async () => reply, calls),
    answers,
  )
  expect(recap?.conclusion).toBe('Repasá JWT antes de la próxima defensa.')
  expect(calls).toHaveLength(1)
  expect((calls[0] as { opts: unknown }).opts).toEqual({
    json: true,
    effort: 'high',
  })
})

test('recapSession falls back to null when the model call fails', async () => {
  const recap = await recapSession(
    fakeLlm(async () => {
      throw new LlmError('El modelo respondió 500.')
    }),
    answers,
  )
  expect(recap).toBeNull()
})

test('recapSession falls back to null when the reply does not parse', async () => {
  const recap = await recapSession(
    fakeLlm(async () => 'Todo bien, sigue así.'),
    answers,
  )
  expect(recap).toBeNull()
})

test('recapSession makes no call when nothing was graded', async () => {
  const calls: unknown[] = []
  const recap = await recapSession(
    fakeLlm(async () => reply, calls),
    [{ question: 'Saltada', grading: null }],
  )
  expect(recap).toBeNull()
  expect(calls).toHaveLength(0)
})

test('readRecapAnswers accepts what the client sends and round-trips it', () => {
  expect(readRecapAnswers(JSON.parse(JSON.stringify(answers)))).toEqual(answers)
})

test('readRecapAnswers refuses a malformed session instead of guessing', () => {
  const [first] = JSON.parse(JSON.stringify(answers))
  expect(readRecapAnswers([])).toBeNull()
  expect(readRecapAnswers('no')).toBeNull()
  expect(
    readRecapAnswers([
      { ...first, grading: { ...first.grading, verdict: 'genial' } },
    ]),
  ).toBeNull()
  expect(
    readRecapAnswers([
      { ...first, grading: { ...first.grading, criteria: null } },
    ]),
  ).toBeNull()
  expect(readRecapAnswers([{ question: '', grading: null }])).toBeNull()
  expect(
    readRecapAnswers(
      Array.from({ length: 41 }, () => ({ question: 'x', grading: null })),
    ),
  ).toBeNull()
})

const reading = parseRecap(reply)!

test('a dispute sends the previous reading and the objection as data, under the revision rule', async () => {
  const calls: { system: string; user: string }[] = []
  const llm: Llm = {
    async complete(system, user) {
      calls.push({ system, user })
      return reply
    },
  }
  const recap = await recapSession(llm, answers, {
    previous: reading,
    dispute: 'La firma sí la explicamos en el acta 3.',
  })
  expect(recap).toEqual(reading)
  expect(calls[0]!.system).toContain('Es una REVISIÓN')
  expect(calls[0]!.user).toContain(reading.analysis)
  expect(calls[0]!.user).toContain('La firma sí la explicamos en el acta 3.')
  expect(calls[0]!.user).toContain('Comentario del estudiante sobre la lectura')
})

test('a first reading is not sent as a revision', async () => {
  const calls: { system: string }[] = []
  const llm: Llm = {
    async complete(system) {
      calls.push({ system })
      return reply
    },
  }
  await recapSession(llm, answers)
  expect(calls[0]!.system).not.toContain('Es una REVISIÓN')
})

test('a dispute the model cannot answer leaves the caller with null, so the previous reading stays', async () => {
  const recap = await recapSession(
    fakeLlm(async () => {
      throw new LlmError('El modelo respondió 503.')
    }),
    answers,
    { previous: reading, dispute: 'No estoy de acuerdo.' },
  )
  expect(recap).toBeNull()
})

test('readRecap accepts a reading this server wrote and rejects anything else', () => {
  expect(readRecap(JSON.parse(JSON.stringify(reading)))).toEqual(reading)
  expect(readRecap({ ...reading, gaps: 'uno' })).toBeNull()
  expect(readRecap(null)).toBeNull()
})

test('readDispute trims, caps and refuses empty comments', () => {
  expect(readDispute('   ')).toBeNull()
  expect(readDispute(42)).toBeNull()
  expect(readDispute(' no estoy de acuerdo ')).toBe('no estoy de acuerdo')
  expect(readDispute('x'.repeat(900))).toHaveLength(600)
})
