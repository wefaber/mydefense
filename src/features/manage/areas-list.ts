export const MANAGE_AREAS = [
  'identidades',
  'personas',
  'materiales',
  'ajustes',
] as const
export type ManageArea = (typeof MANAGE_AREAS)[number]
