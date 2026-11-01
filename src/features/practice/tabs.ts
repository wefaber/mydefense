export const TABS = [
  ['puntos', 'Mis puntos'],
  ['quiz', 'Quiz'],
  ['banco', 'Banco'],
  ['temas', 'Temas'],
  ['ejercicios', 'Ejercicios'],
  ['pendientes', 'Pendientes'],
  ['datos', 'Datos'],
] as const

export type TabId = (typeof TABS)[number][0]
export const isTab = (v: string): v is TabId => TABS.some(([id]) => id === v)
