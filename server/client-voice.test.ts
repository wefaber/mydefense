// Tests for the browser-side voice protocol (`src/lib/voice`). They live here because only the server tsconfig
// carries the bun test types; the code under test has no DOM dependency beyond the injected socket.
import { expect, test } from 'bun:test'
import { floatToPcm16, resample } from '../src/lib/voice/pcm'
import {
  SttSession,
  parseSttMessage,
  sttUrl,
  tidy,
  type Socket,
} from '../src/lib/voice/stt'

class FakeSocket implements Socket {
  sent: (string | Uint8Array)[] = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((data: unknown) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  send(data: string | Uint8Array) {
    this.sent.push(data)
  }
  close() {
    this.closed = true
  }
  say(obj: unknown) {
    this.onmessage?.(JSON.stringify(obj))
  }
}

const make = () => {
  const sock = new FakeSocket()
  const got = { interim: [] as string[], errors: [] as string[] }
  const stt = new SttSession(sock, {
    onInterim: (t) => got.interim.push(t),
    onError: (m) => got.errors.push(m),
  })
  return { sock, stt, got }
}

test('the url carries model, format, language and the token, never an api key', () => {
  const url = sttUrl('tok+1', '2026-08-14')
  expect(url.startsWith('wss://api.cartesia.ai/stt/websocket?')).toBe(true)
  expect(url).toContain('model=ink-2')
  expect(url).toContain('encoding=pcm_s16le')
  expect(url).toContain('sample_rate=16000')
  expect(url).toContain('language=es')
  expect(url).toContain('access_token=tok%2B1')
  expect(url).not.toContain('api_key')
})

test('parseSttMessage understands the four messages and ignores the rest', () => {
  expect(
    parseSttMessage(
      JSON.stringify({ type: 'transcript', is_final: true, text: 'hola' }),
    ),
  ).toEqual({ type: 'transcript', isFinal: true, text: 'hola' })
  expect(parseSttMessage('{"type":"flush_done"}')).toEqual({
    type: 'flush_done',
  })
  expect(parseSttMessage('{"type":"error","message":"cuota"}')).toEqual({
    type: 'error',
    message: 'cuota',
  })
  expect(parseSttMessage('no es json')).toBeNull()
  expect(parseSttMessage(new ArrayBuffer(4))).toBeNull()
  expect(parseSttMessage('{"type":"otra"}')).toBeNull()
})

test('finalize waits for flush_done and returns the joined final text', async () => {
  const { sock, stt, got } = make()
  sock.onopen?.()
  await stt.ready
  sock.say({ type: 'transcript', is_final: false, text: 'lux cent' })
  sock.say({ type: 'transcript', is_final: true, text: 'Lux centraliza' })
  sock.say({ type: 'transcript', is_final: true, text: 'el inventario' })
  const done = stt.finalize()
  expect(sock.sent).toContain('finalize')
  sock.say({ type: 'flush_done' })
  expect(await done).toBe('Lux centraliza el inventario')
  expect(got.interim.at(-1)).toBe('Lux centraliza el inventario')
})

test('an error mid-recording is reported once and unblocks a pending finalize', async () => {
  const { sock, stt, got } = make()
  sock.onopen?.()
  await stt.ready
  sock.say({ type: 'transcript', is_final: true, text: 'parcial' })
  const done = stt.finalize()
  sock.say({ type: 'error', message: 'cuota agotada' })
  expect(await done).toBe('parcial')
  expect(got.errors).toEqual(['cuota agotada'])
  expect(sock.closed).toBe(true)
})

test('a connection that never opens rejects ready; audio after close is dropped', async () => {
  const { sock, stt } = make()
  sock.onerror?.()
  await expect(stt.ready).rejects.toThrow('No se pudo conectar')
  stt.close()
  stt.sendAudio(new Uint8Array(2))
  expect(sock.sent).toHaveLength(0)
})

test('PCM16 conversion clips and resampling keeps the length ratio', () => {
  const view = new DataView(floatToPcm16(Float32Array.from([2, -2])).buffer)
  expect(view.getInt16(0, true)).toBe(0x7fff)
  expect(view.getInt16(2, true)).toBe(-0x8000)
  expect(resample(new Float32Array(4800).fill(0.5), 48000, 16000)).toHaveLength(
    1600,
  )
})

test('tidy closes the space Ink leaves before punctuation', () => {
  expect(tidy('memoria , así que  atacarlo .')).toBe(
    'memoria, así que atacarlo.',
  )
})

test('finalize returns tidied text', async () => {
  const { sock, stt } = make()
  sock.onopen?.()
  await stt.ready
  sock.say({ type: 'transcript', is_final: true, text: 'hola , mundo' })
  const done = stt.finalize()
  sock.say({ type: 'flush_done' })
  expect(await done).toBe('hola, mundo')
})
