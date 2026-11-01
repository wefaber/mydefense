import { createContext, use } from 'react'
import type { Identity, Practice } from '../../lib/queries'

export type Defense = NonNullable<Practice['defense']>

export interface PracticeContextValue {
  team: Practice
  defense: Defense
  me: Identity
}

export const PracticeContext = createContext<PracticeContextValue | null>(null)

export function usePracticeContext(): PracticeContextValue {
  const value = use(PracticeContext)
  if (!value) throw new Error('usePracticeContext outside PracticeShell')
  return value
}
