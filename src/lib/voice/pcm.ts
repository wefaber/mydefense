/** Audio helpers without a browser, so they are tested with `bun test`. Lifted from eternum-board (`features/voice/audio.ts`). */

/** Bytes with their own buffer: what `WebSocket.send` accepts. */
export type Bytes = Uint8Array<ArrayBuffer>

/** Float32 in [-1, 1] to little-endian PCM16 (Cartesia STT `pcm_s16le`). */
export function floatToPcm16(input: Float32Array): Bytes {
  const out: Bytes = new Uint8Array(input.length * 2)
  const view = new DataView(out.buffer)
  for (let i = 0; i < input.length; i++) {
    const x = Math.max(-1, Math.min(1, input[i]!))
    view.setInt16(i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true)
  }
  return out
}

/** Linear resampling from `from` Hz to `to` Hz. Enough for speech, not a music-grade filter. */
export function resample(
  input: Float32Array,
  from: number,
  to: number,
): Float32Array {
  if (from === to) return input
  const n = Math.floor((input.length * to) / from)
  const out = new Float32Array(n)
  const step = from / to
  for (let i = 0; i < n; i++) {
    const pos = i * step
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const f = pos - i0
    out[i] = input[i0]! * (1 - f) + input[i1]! * f
  }
  return out
}
