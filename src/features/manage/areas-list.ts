export const MANAGE_AREAS = [
  'identidades',
  'personas',
  'materiales',
  'defensa',
  'ajustes',
] as const
export type ManageArea = (typeof MANAGE_AREAS)[number]
