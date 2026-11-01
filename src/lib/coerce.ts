export const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : []
export const asString = (v: unknown): string => (typeof v === 'string' ? v : '')
