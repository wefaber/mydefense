/**
 * Microphone to text for one oral answer: press record, speak, press stop. The audio goes straight from the browser
 * to Cartesia Ink; the server only mints the short-lived token and never sees or stores the audio.
 * Browser glue (getUserMedia + AudioWorklet): the protocol it drives lives in `stt.ts` and is tested there.
 */
import { floatToPcm16, resample } from './pcm'
import {
  STT_RATE,
  SttSession,
  browserSocket,
  sttUrl,
  type SocketFactory,
} from './stt'

export interface Recording {
  text: string
  /** Time between pressing record and stop. */
  ms: number
}

export interface Recorder {
  /** Needs a user gesture (the AudioContext requires it). Rejects with a message that is safe to show. */
  start(): Promise<void>
  /** Stops listening and returns the transcript. */
  stop(): Promise<Recording>
  /** Drops everything without a transcript. */
  cancel(): void
}

export interface RecorderDeps {
  token: () => Promise<{ token: string; version: string }>
  onInterim: (text: string) => void
  onError: (message: string) => void
  socket?: SocketFactory
}

/** Gathers microphone samples into blocks of 4096 and posts them to the main thread. */
const TAP_SOURCE = `
class PcmTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(4096); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
    }
    return true;
  }
}
registerProcessor("pcm-tap", PcmTap);`

export function createRecorder(deps: RecorderDeps): Recorder {
  let stt: SttSession | null = null
  let stream: MediaStream | null = null
  let ctx: AudioContext | null = null
  let tap: AudioWorkletNode | null = null
  let startedAt = 0
  let generation = 0

  const release = () => {
    generation++
    tap?.disconnect()
    tap = null
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    void ctx?.close().catch(() => {})
    ctx = null
  }

  const cancel = () => {
    release()
    stt?.close()
    stt = null
  }

  return {
    async start() {
      if (stt) return
      const my = ++generation
      const { token, version } = await deps.token()
      if (my !== generation) return
      const session = new SttSession(
        (deps.socket ?? browserSocket)(sttUrl(token, version)),
        {
          onInterim: deps.onInterim,
          onError: (message) => {
            cancel()
            deps.onError(message)
          },
        },
      )
      await session.ready
      if (my !== generation) return session.close()
      stt = session
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
        if (my !== generation) return cancel()
        const audio = new AudioContext()
        ctx = audio
        await audio.resume()
        const moduleUrl = URL.createObjectURL(
          new Blob([TAP_SOURCE], { type: 'text/javascript' }),
        )
        await audio.audioWorklet.addModule(moduleUrl)
        URL.revokeObjectURL(moduleUrl)
        if (my !== generation) return cancel()
        const node = new AudioWorkletNode(audio, 'pcm-tap', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        })
        // The worklet only runs while connected to the output; zero gain keeps the microphone inaudible.
        const silent = audio.createGain()
        silent.gain.value = 0
        audio.createMediaStreamSource(stream).connect(node)
        node.connect(silent)
        silent.connect(audio.destination)
        node.port.onmessage = (e: MessageEvent<Float32Array>) =>
          stt?.sendAudio(
            floatToPcm16(resample(e.data, audio.sampleRate, STT_RATE)),
          )
        tap = node
        startedAt = performance.now()
      } catch (err) {
        cancel()
        const denied =
          err instanceof DOMException && err.name === 'NotAllowedError'
        throw new Error(
          denied
            ? 'Falta permiso para usar el micrófono.'
            : 'No se pudo abrir el micrófono.',
        )
      }
    },

    async stop() {
      const session = stt
      const ms = Math.round(performance.now() - startedAt)
      release()
      if (!session) return { text: '', ms: 0 }
      const text = await session.finalize()
      session.close()
      stt = null
      return { text, ms }
    },

    cancel,
  }
}
