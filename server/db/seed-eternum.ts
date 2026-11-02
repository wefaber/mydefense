import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import type { Db } from './connection.ts'
import * as t from './schema.ts'

/** Shapes of the globals in `seed/eternum/data.js` (lux `docs/defensa`). */
interface RawPerson {
  name: string
  role: string
  sectors: string
  points: string[]
}
interface RawPoint {
  id: string
  block: number
  title: string
  guion: string
  say: string[]
  code: string[]
  qa: [string, string][]
  st: 'ok' | 'fill' | 'pend'
  todo: string
}
interface RawAso {
  n: number
  unit: string
  q: string
  exp: string
  lux: string
  cmds?: string[]
  todo?: string
}
interface RawTopic {
  n: number
  title: string
  lesson: string[]
  code: string[]
  qa: [string, string][]
}
interface RawExercise {
  title: string
  time: string
  goal: string
  steps: string[]
  files: string[]
  learn: string
}
interface RawPending {
  t: string
  s: string
}
export interface EternumData {
  PEOPLE: Record<string, RawPerson>
  BLOCKS: Record<string, string>
  POINTS: RawPoint[]
  ASO: RawAso[]
  TOPICS: RawTopic[]
  EXERCISES: RawExercise[]
  PENDING: RawPending[]
  FACTS: [string, string, string][]
  CRITERIA: [string, string][]
}

/** `data.js` declares top-level consts: run it in an empty VM context (no process, no require, time-boxed) and read them back. */
export function parseEternumData(source: string): EternumData {
  const names =
    'PEOPLE,BLOCKS,POINTS,ASO,TOPICS,EXERCISES,PENDING,FACTS,CRITERIA'
  return runInNewContext(`${source}\n;({ ${names} })`, Object.create(null), {
    timeout: 2000,
  }) as EternumData
}

export interface SeedResult {
  created: boolean
  teamId: string
  counts: Record<string, number>
}

type QuestionRow = Omit<
  typeof t.questions.$inferInsert,
  'id' | 'teamId' | 'defenseId' | 'status' | 'validatorNotes' | 'position'
>

/** Maps the Eternum study tool into the generic model. Idempotent: does nothing if the team exists. */
export function seedEternum(
  db: Db,
  data: EternumData,
  now: () => Date = () => new Date(),
): SeedResult {
  const existing = db
    .select()
    .from(t.teams)
    .where(eq(t.teams.slug, 'eternum'))
    .get()
  if (existing) return { created: false, teamId: existing.id, counts: {} }

  const stamp = now().toISOString()
  const teamId = ulid()
  const defenseId = ulid()
  const sectionIds = new Map<number, string>()
  const owners = new Map<string, string>()
  const counts = {
    identities: 0,
    sections: 0,
    points: 0,
    pointQuestions: 0,
    bank: 0,
    topicQuestions: 0,
    resources: 0,
  }

  db.transaction((tx) => {
    tx.insert(t.teams)
      .values({
        id: teamId,
        slug: 'eternum',
        name: 'Eternum',
        visibility: 'public',
        createdAt: stamp,
      })
      .run()

    Object.entries(data.PEOPLE).forEach(([key, person], position) => {
      const id = ulid()
      for (const code of person.points) owners.set(code, id)
      tx.insert(t.identities)
        .values({
          id,
          teamId,
          key,
          name: person.name,
          role: person.role,
          sectors: person.sectors,
          position,
        })
        .run()
      counts.identities++
    })

    tx.insert(t.defenses)
      .values({
        id: defenseId,
        teamId,
        title: 'Defensa final',
        date: '2026-11-04',
        criteria: data.CRITERIA.map(([name, description]) => ({
          name,
          description,
        })),
      })
      .run()

    for (const [number, title] of Object.entries(data.BLOCKS)) {
      const id = ulid()
      sectionIds.set(Number(number), id)
      tx.insert(t.sections)
        .values({ id, teamId, defenseId, number: Number(number), title })
        .run()
      counts.sections++
    }

    let q = 0
    const question = (row: QuestionRow) => {
      tx.insert(t.questions)
        .values({
          ...row,
          id: ulid(),
          teamId,
          defenseId,
          status: 'approved',
          validatorNotes: '',
          position: q++,
        })
        .run()
    }

    data.POINTS.forEach((p, position) => {
      const id = ulid()
      tx.insert(t.points)
        .values({
          id,
          teamId,
          defenseId,
          sectionId: sectionIds.get(p.block)!,
          ownerId: owners.get(p.id) ?? null,
          code: p.id,
          title: p.title,
          script: p.guion,
          say: p.say,
          refs: p.code,
          status: p.st,
          todo: p.todo,
          position,
        })
        .run()
      counts.points++
      for (const [prompt, modelAnswer] of p.qa) {
        question({
          pointId: id,
          group: 'point',
          prompt,
          modelAnswer,
          source: `Punto ${p.id}`,
          extra: {},
        })
        counts.pointQuestions++
      }
    })

    for (const a of data.ASO) {
      question({
        pointId: null,
        group: 'bank',
        prompt: a.q,
        modelAnswer: a.lux,
        source: `ASO ${a.n} (${a.unit})`,
        extra: {
          n: a.n,
          unit: a.unit,
          expected: a.exp,
          cmds: a.cmds ?? [],
          todo: a.todo ?? '',
        },
      })
      counts.bank++
    }

    let r = 0
    const resource = (
      kind: typeof t.resources.$inferInsert.kind,
      title: string,
      body: Record<string, unknown>,
    ) => {
      tx.insert(t.resources)
        .values({
          id: ulid(),
          teamId,
          defenseId,
          kind,
          title,
          body,
          position: r++,
        })
        .run()
      counts.resources++
    }

    for (const topic of data.TOPICS) {
      resource('lesson', topic.title, {
        n: topic.n,
        lesson: topic.lesson,
        code: topic.code,
      })
      for (const [prompt, modelAnswer] of topic.qa) {
        question({
          pointId: null,
          group: 'topic',
          prompt,
          modelAnswer,
          source: `Tema ${topic.n}: ${topic.title}`,
          extra: { topic: topic.n },
        })
        counts.topicQuestions++
      }
    }
    for (const e of data.EXERCISES) {
      resource('exercise', e.title, {
        time: e.time,
        goal: e.goal,
        steps: e.steps,
        files: e.files,
        learn: e.learn,
      })
    }
    for (const p of data.PENDING) resource('pending', p.t, { text: p.s })
    for (const [title, value, source] of data.FACTS)
      resource('fact', title, { value, source })
  })

  return { created: true, teamId, counts }
}

/** Seeds Eternum from the copy of `data.js` shipped in the repo. Run at every boot: a fresh database has the team. */
export function seedEternumFromDisk(db: Db): SeedResult {
  const source = readFileSync(
    join(import.meta.dir, '..', '..', 'seed', 'eternum', 'data.js'),
    'utf8',
  )
  return seedEternum(db, parseEternumData(source))
}
