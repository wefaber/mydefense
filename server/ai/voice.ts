/**
 * Cartesia Ink (speech to text) runs in the browser over a WebSocket. The API key stays here: the browser asks for a
 * short-lived token that only grants `stt`. Lifted from eternum-board (`server/voice.ts`).
 */
export const CARTESIA_VERSION = '2026-08-14'
const CARTESIA_HTTP = 'https://api.cartesia.ai'
export const TOKEN_SECONDS = 120

export interface VoiceConfig {
  apiKey: string
  version: string
  fetch?: typeof fetch
}

/** Safe to show: never carries the key or Cartesia's response body. */
export class VoiceError extends Error {}

export function voiceFromEnv(
  env: Record<string, string | undefined>,
): VoiceConfig | null {
  const apiKey = env.CARTESIA_API_KEY?.trim()
  if (!apiKey) return null
  return { apiKey, version: env.CARTESIA_VERSION?.trim() || CARTESIA_VERSION }
}

export interface VoiceToken {
  token: string
  expiresIn: number
  version: string
}

export async function mintToken(cfg: VoiceConfig): Promise<VoiceToken> {
  const doFetch = cfg.fetch ?? fetch
  let res: Response
  try {
    res = await doFetch(`${CARTESIA_HTTP}/access-token`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        'cartesia-version': cfg.version,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        grants: { stt: true },
        expires_in: TOKEN_SECONDS,
      }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new VoiceError('No se pudo conectar con la voz.')
  }
  if (!res.ok) throw new VoiceError(`La voz rechazó el pedido (${res.status}).`)
  const data = (await res.json().catch(() => null)) as {
    token?: unknown
  } | null
  if (typeof data?.token !== 'string' || !data.token)
    throw new VoiceError('La voz no devolvió un token.')
  return { token: data.token, expiresIn: TOKEN_SECONDS, version: cfg.version }
}
