import { useMutation } from '@tanstack/react-query'
import { Button, Textarea } from '@wefaber/ui'
import { Loader2, Mic, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  CRITERIA_LABELS,
  gradeAnswer,
  voiceToken,
  type Grading,
} from '../../lib/answer'
import { createRecorder, type Recorder } from '../../lib/voice/recorder'

type Phase = 'idle' | 'connecting' | 'recording' | 'transcribing'

/**
 * Where the student defends the point: type the answer or record it, then get it graded against the reference.
 * `onGraded` hands the result up so the quiz can reveal the model answer and suggest the self-grade.
 */
export function AnswerBox({
  teamSlug,
  questionId,
  voice,
  onGraded,
}: {
  teamSlug: string
  questionId: string
  voice: boolean
  onGraded: (g: Grading) => void
}) {
  const [text, setText] = useState('')
  const [spokenMs, setSpokenMs] = useState<number | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const recorder = useRef<Recorder | null>(null)

  useEffect(() => () => recorder.current?.cancel(), [])

  const grade = useMutation({
    mutationFn: () =>
      gradeAnswer({ teamSlug, questionId, answer: text, spokenMs }),
    onSuccess: onGraded,
  })

  const start = async () => {
    setVoiceError(null)
    setPhase('connecting')
    const rec = createRecorder({
      token: voiceToken,
      onInterim: setText,
      onError: (message) => {
        recorder.current = null
        setPhase('idle')
        setVoiceError(message)
      },
    })
    recorder.current = rec
    try {
      await rec.start()
      setText('')
      setSpokenMs(null)
      setPhase('recording')
    } catch (e) {
      recorder.current = null
      setPhase('idle')
      setVoiceError(e instanceof Error ? e.message : 'No se pudo grabar.')
    }
  }

  const stop = async () => {
    const rec = recorder.current
    if (!rec) return
    setPhase('transcribing')
    const { text: heard, ms } = await rec.stop()
    recorder.current = null
    setPhase('idle')
    if (heard) {
      setText(heard)
      setSpokenMs(ms)
    } else {
      setVoiceError(
        'No se escuchó nada. Probá de nuevo, más cerca del micrófono.',
      )
    }
  }

  const busy = phase !== 'idle'
  const label =
    phase === 'connecting'
      ? 'Conectando…'
      : phase === 'transcribing'
        ? 'Transcribiendo…'
        : 'Grabar respuesta'

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="answer" className="text-body-lg font-medium">
        Tu respuesta
      </label>
      <Textarea
        id="answer"
        rows={5}
        value={text}
        readOnly={busy}
        placeholder="Escribila con tus palabras, o grabala."
        onChange={(e) => {
          setText(e.target.value)
          setSpokenMs(null)
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        {voice && (
          <Button
            variant="secondary"
            size="lg"
            disabled={phase === 'connecting' || phase === 'transcribing'}
            onClick={() => void (phase === 'recording' ? stop() : start())}
          >
            {phase === 'recording' ? (
              <>
                <Square aria-hidden size={16} /> Detener
              </>
            ) : (
              <>
                {busy ? (
                  <Loader2 aria-hidden size={16} className="animate-spin" />
                ) : (
                  <Mic aria-hidden size={16} />
                )}
                {label}
              </>
            )}
          </Button>
        )}
        <Button
          variant="primary"
          size="lg"
          disabled={busy || grade.isPending || text.trim() === ''}
          onClick={() => grade.mutate()}
        >
          {grade.isPending ? 'Corrigiendo…' : 'Corregir'}
        </Button>
      </div>
      <p aria-live="polite" className="text-meta text-muted">
        {phase === 'recording'
          ? 'Escuchando. Hablá como en la defensa y tocá Detener al terminar.'
          : voice
            ? 'El audio va directo al servicio de voz y no se guarda.'
            : ''}
      </p>
      {voiceError && (
        <p role="alert" className="text-body-lg text-danger">
          {voiceError}
        </p>
      )}
      {grade.error && (
        <p role="alert" className="text-body-lg text-danger">
          {grade.error.message}
        </p>
      )}
    </div>
  )
}

const VERDICT: Record<Grading['verdict'], { label: string; tone: string }> = {
  complete: { label: 'Completa', tone: 'text-success' },
  partial: { label: 'Parcial', tone: 'text-warning' },
  insufficient: { label: 'Insuficiente', tone: 'text-danger' },
}

function Bullets({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null
  return (
    <div>
      <b className="text-meta font-semibold text-muted">{title}</b>
      <ul className="mt-0.5 list-disc pl-5 text-body-lg">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  )
}

/** The correction: verdict, the three rubric criteria, what was and was not covered, and pace for spoken answers. */
export function GradingPanel({ grading }: { grading: Grading }) {
  const v = VERDICT[grading.verdict]
  const d = grading.delivery
  return (
    <section
      aria-label="Corrección"
      className="flex flex-col gap-3 rounded-card bg-surface-2 p-4"
    >
      <p className={`text-h3 font-semibold ${v.tone}`}>{v.label}</p>
      {grading.feedback && <p className="text-body-lg">{grading.feedback}</p>}
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-3">
        {(Object.keys(CRITERIA_LABELS) as (keyof typeof CRITERIA_LABELS)[]).map(
          (k) => (
            <div key={k}>
              <dt className="text-meta text-muted">{CRITERIA_LABELS[k]}</dt>
              <dd className="text-body-lg font-medium tabular-nums">
                {grading.criteria[k]} / 4
              </dd>
            </div>
          ),
        )}
      </dl>
      <Bullets title="Lo que cubriste" items={grading.covered} />
      <Bullets title="Lo que faltó" items={grading.missing} />
      <Bullets
        title="Sin respaldo en el material"
        items={grading.unsupported}
      />
      {d && (
        <p className="text-meta text-muted">
          {d.words} palabras
          {d.wpm !== null && <> · {d.wpm} palabras por minuto</>}
          {d.fillers.length > 0 && (
            <>
              {' '}
              · muletillas:{' '}
              {d.fillers.map((f) => `"${f.word}" ×${f.count}`).join(', ')}
            </>
          )}
        </p>
      )}
    </section>
  )
}
