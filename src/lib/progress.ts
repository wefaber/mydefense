import { useSyncExternalStore } from 'react'
import type { Grade } from '../../shared/types'

/** What the browser remembers per team. Nothing here ever leaves the device. */
export interface Progress {
  /** Last identity key picked. */
  who: string | null
  /** "<identityKey>|<pointCode>" → 0 no lo sé · 1 a medias · 2 lo domino. */
  ratings: Record<string, 0 | 1 | 2>
  /** identityKey → self-graded answers. */
  quiz: Record<string, Record<Grade, number>>
}

const EMPTY: Progress = { who: null, ratings: {}, quiz: {} }
const PREFIX = 'mydefense-v1:'
const cache = new Map<string, Progress>()
const listeners = new Set<() => void>()

function read(slug: string): Progress {
  try {
    const raw = localStorage.getItem(PREFIX + slug)
    if (raw) return { ...EMPTY, ...(JSON.parse(raw) as Partial<Progress>) }
  } catch {
    // Private mode or corrupted value: start clean.
  }
  return EMPTY
}

function get(slug: string): Progress {
  let value = cache.get(slug)
  if (!value) {
    value = read(slug)
    cache.set(slug, value)
  }
  return value
}

function write(slug: string, next: Progress): void {
  cache.set(slug, next)
  try {
    localStorage.setItem(PREFIX + slug, JSON.stringify(next))
  } catch {
    // No storage: progress lasts until the tab closes.
  }
  listeners.forEach((l) => l())
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setWho(slug: string, who: string): void {
  write(slug, { ...get(slug), who })
}

export function setRating(
  slug: string,
  who: string,
  code: string,
  value: 0 | 1 | 2 | undefined,
): void {
  const ratings = { ...get(slug).ratings }
  if (value === undefined) delete ratings[`${who}|${code}`]
  else ratings[`${who}|${code}`] = value
  write(slug, { ...get(slug), ratings })
}

export function addGrade(slug: string, who: string, grade: Grade): void {
  const current = get(slug)
  const tally = current.quiz[who] ?? {
    complete: 0,
    partial: 0,
    insufficient: 0,
  }
  write(slug, {
    ...current,
    quiz: { ...current.quiz, [who]: { ...tally, [grade]: tally[grade] + 1 } },
  })
}

export function useProgress(slug: string): Progress {
  return useSyncExternalStore(
    subscribe,
    () => get(slug),
    () => EMPTY,
  )
}
