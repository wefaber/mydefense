/**
 * Cartesia Ink speech-to-text over a WebSocket, without depending on the browser: the socket comes from a factory so
 * tests swap it for a fake. PCM16 16 kHz goes out as binary; `finalize` asks for the text of what was buffered and
 * Cartesia answers with final `transcript` messages and then `flush_done`.
 * Lifted from eternum-board (`features/voice/cartesia.ts`), STT only.
 */
import type { Bytes } from './pcm'

export const STT_MODEL = 'ink-2'
export const STT_RATE = 16000
const HOST = 'wss://api.cartesia.ai'
const FINALIZE_TIMEOUT_MS = 8000

export interface Socket {
  send(data: string | Bytes): void
  close(): void
  onopen: (() => void) | null
  onmessage: ((data: unknown) => void) | null
  onerror: (() => void) | null
  onclose: (() => void) | null
}

export type SocketFactory = (url: string) => Socket

export const browserSocket: SocketFactory = (url) => {
  const ws = new WebSocket(url)
  ws.binaryType = 'arraybuffer'
  const sock: Socket = {
    send: (data) => ws.send(data),
    close: () => ws.close(),
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
  }
  ws.onopen = () => sock.onopen?.()
  ws.onmessage = (e) => sock.onmessage?.(e.data)
  ws.onerror = () => sock.onerror?.()
  ws.onclose = () => sock.onclose?.()
  return sock
}

/** The token is short-lived and only grants STT; it travels in the query because browsers cannot set headers on a WebSocket. */
export const sttUrl = (token: string, version: string) =>
  `${HOST}/stt/websocket?model=${STT_MODEL}&encoding=pcm_s16le&sample_rate=${STT_RATE}&language=es&cartesia_version=${version}&access_token=${encodeURIComponent(token)}`

export type SttMessage =
  | { type: 'transcript'; isFinal: boolean; text: string }
  | { type: 'flush_done' }
  | { type: 'done' }
  | { type: 'error'; message: string }

export function parseSttMessage(raw: unknown): SttMessage | null {
  if (typeof raw !== 'string') return null
  let o: Record<string, unknown>
  try {
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== 'object') return null
    o = v as Record<string, unknown>
  } catch {
    return null
  }
  switch (o.type) {
    case 'transcript':
      return {
        type: 'transcript',
        isFinal: o.is_final === true,
        text: typeof o.text === 'string' ? o.text : '',
      }
    case 'flush_done':
      return { type: 'flush_done' }
    case 'done':
      return { type: 'done' }
    case 'error':
      return {
        type: 'error',
        message:
          typeof o.message === 'string' && o.message
            ? o.message
            : 'Error de la voz.',
      }
    default:
      return null
  }
}

/** Ink puts a space before punctuation ("memoria , así"); close it up. */
export const tidy = (text: string) =>
  text
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()

export interface SttHandlers {
  /** What has been recognized so far. */
  onInterim(text: string): void
  /** The connection or the service failed. The session is closed. */
  onError(message: string): void
}

export class SttSession {
  readonly ready: Promise<void>
  private finalText = ''
  private closed = false
  private pending: ((text: string) => void) | null = null

  private readonly sock: Socket
  private readonly h: SttHandlers

  constructor(sock: Socket, h: SttHandlers) {
    this.sock = sock
    this.h = h
    let opened = false
    this.ready = new Promise<void>((resolve, reject) => {
      sock.onopen = () => {
        opened = true
        resolve()
      }
      const lost = () => {
        if (!opened) return reject(new Error('No se pudo conectar con la voz.'))
        this.fail('Se cortó la conexión con la voz.')
      }
      sock.onerror = lost
      sock.onclose = lost
    })
    this.ready.catch(() => {})
    sock.onmessage = (raw) => this.receive(raw)
  }

  private fail(message: string): void {
    if (this.closed) return
    this.closed = true
    this.pending?.(tidy(this.finalText))
    this.pending = null
    this.h.onError(message)
  }

  private receive(raw: unknown): void {
    if (this.closed) return
    const m = parseSttMessage(raw)
    if (!m) return
    if (m.type === 'transcript') {
      if (m.isFinal)
        this.finalText += (this.finalText ? ' ' : '') + m.text.trim()
      this.h.onInterim(
        m.isFinal ? this.finalText : `${this.finalText} ${m.text}`.trim(),
      )
    } else if (m.type === 'flush_done') {
      this.pending?.(tidy(this.finalText))
      this.pending = null
    } else if (m.type === 'error') {
      this.fail(m.message)
      this.sock.close()
    }
  }

  sendAudio(pcm16: Bytes): void {
    if (!this.closed) this.sock.send(pcm16)
  }

  /** Asks for the text of everything sent and waits for it. Resolves with whatever arrived if the wait times out. */
  finalize(): Promise<string> {
    if (this.closed) return Promise.resolve(tidy(this.finalText))
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending = null
        resolve(tidy(this.finalText))
      }, FINALIZE_TIMEOUT_MS)
      this.pending = (text) => {
        clearTimeout(timer)
        resolve(text)
      }
      this.sock.send('finalize')
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.sock.close()
  }
}
