import { useMutation } from '@tanstack/react-query'
import { Button, Textarea } from '@wefaber/ui'
import { Loader2, Mic, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  CRITERIA_LABELS,
  gradeAnswer,
  NOTE_MAX_CHARS,
  voiceToken,
  type Grading,
} from '../../lib/answer'
import { createRecorder, type Recorder } from '../../lib/voice/recorder'

type Phase = 'idle' | 'connecting' | 'recording' | 'transcribing'

/**
 * Where the student defends the point: type the answer or record it, then get it graded against the reference.
 * `onGraded` hands the result up so the quiz can reveal the model answer and suggest the self-grade.
 * `expired` (the mock defense's clock ran out) stops any recording and submits what there is, once.
 */
export function AnswerBox({
  teamSlug,
  questionId,
  voice,
  onGraded,
  expired = false,
}: {
  teamSlug: string
  questionId: string
  voice: boolean
  onGraded: (g: Grading) => void
  expired?: boolean
}) {
  const [text, setText] = useState('')
  const [spokenMs, setSpokenMs] = useState<number | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const recorder = useRef<Recorder | null>(null)
  const submitted = useRef(false)

  useEffect(() => () => recorder.current?.cancel(), [])

  const grade = useMutation({
    mutationFn: (v: { answer: string; spokenMs: number | null }) =>
      gradeAnswer({ teamSlug, questionId, ...v }),
    onSuccess: onGraded,
  })

  const submit = (answer: string, ms: number | null) => {
    if (submitted.current) return
    submitted.current = true
    grade.mutate(
      { answer, spokenMs: ms },
      { onError: () => (submitted.current = false) },
    )
  }

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

  const stop = async (thenSubmit = false) => {
    const rec = recorder.current
    if (!rec) return
    setPhase('transcribing')
    const { text: heard, ms } = await rec.stop()
    recorder.current = null
    setPhase('idle')
    if (heard) {
      setText(heard)
      setSpokenMs(ms)
      if (thenSubmit) submit(heard, ms)
    } else {
      if (thenSubmit) submit('', null)
      setVoiceError(
        'No se escuchó nada. Probá de nuevo, más cerca del micrófono.',
      )
    }
  }

  // The clock ran out: take whatever is in the box, or what the microphone still holds.
  useEffect(() => {
    if (!expired || submitted.current) return
    if (phase === 'recording') void stop(true)
    else if (phase === 'idle') submit(text, spokenMs)
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [expired, phase])

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
          onClick={() => submit(text, spokenMs)}
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

const CONFIDENCE = { high: 'alta', medium: 'media', low: 'baja' } as const

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null)

/** The Board documents the correction cited, numbered as in the text. A link opens the document; otherwise its path. */
function Sources({ items }: { items: Grading['sources'] }) {
  if (!items.length) return null
  return (
    <div>
      <b className="text-meta font-semibold text-muted">Fuentes citadas</b>
      <ol className="mt-1 flex flex-col gap-2">
        {items.map((src) => (
          <li key={src.n} className="text-body-lg">
            <span className="tabular-nums text-muted">[{src.n}]</span>{' '}
            {src.url ? (
              <a
                href={src.url}
                target="_blank"
                rel="noreferrer noopener"
                className="underline"
              >
                {src.title}
              </a>
            ) : (
              <b>{src.title}</b>
            )}
            <span className="block text-meta text-muted">
              {[
                src.code,
                src.kind === 'issue' ? 'issue' : null,
                day(src.created) && `creado ${day(src.created)}`,
                day(src.closed) && `cerrado ${day(src.closed)}`,
                src.url ? null : src.path,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <span className="block text-meta">{src.snippet}</span>
          </li>
        ))}
      </ol>
    </div>
  )
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

/** The student explains what they meant and the answer is graded again with that comment. */
function Revise({
  teamSlug,
  questionId,
  grading,
  onRevised,
}: {
  teamSlug: string
  questionId: string
  grading: Grading
  onRevised: (g: Grading) => void
}) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const revise = useMutation({
    mutationFn: () =>
      gradeAnswer({
        teamSlug,
        questionId,
        answer: grading.answer,
        spokenMs: null,
        note,
      }),
    // The pace of a spoken answer belongs to the recording, not to the review.
    onSuccess: (g) => {
      onRevised({ ...g, delivery: grading.delivery })
      setOpen(false)
    },
  })
  if (!open)
    return (
      <div>
        <Button
          variant="secondary"
          onClick={() => {
            setNote(grading.note)
            setOpen(true)
          }}
        >
          {grading.note ? 'Editar mi comentario' : 'No coincido: justificar'}
        </Button>
      </div>
    )
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor="revise-note"
        className="text-meta font-semibold text-muted"
      >
        Explicá qué quisiste decir o por qué tu respuesta es válida
      </label>
      <Textarea
        id="revise-note"
        rows={3}
        maxLength={NOTE_MAX_CHARS}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          disabled={revise.isPending || note.trim() === ''}
          onClick={() => revise.mutate()}
        >
          {revise.isPending ? 'Revisando…' : 'Pedir revisión'}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
      {revise.error && (
        <p role="alert" className="text-body-lg text-danger">
          {revise.error.message}
        </p>
      )}
    </div>
  )
}

/**
 * The correction: your answer, the verdict, the three rubric criteria, what was and was not covered, and pace for spoken answers.
 * With `revision`, you can add a comment that justifies the answer and have it graded again.
 */
export function GradingPanel({
  grading,
  revision,
}: {
  grading: Grading
  revision?: {
    teamSlug: string
    questionId: string
    onRevised: (g: Grading) => void
  }
}) {
  const v = VERDICT[grading.verdict]
  const d = grading.delivery
  return (
    <section
      aria-label="Corrección"
      className="flex flex-col gap-3 rounded-card bg-surface-2 p-4"
    >
      <div>
        <b className="text-meta font-semibold text-muted">Tu respuesta</b>
        <p className="mt-0.5 whitespace-pre-wrap text-body-lg">
          {grading.answer}
        </p>
        {grading.note && (
          <p className="mt-1 whitespace-pre-wrap text-body-lg text-muted">
            <b className="text-meta font-semibold">Tu comentario: </b>
            {grading.note}
          </p>
        )}
      </div>
      <p className={`text-h3 font-semibold ${v.tone}`}>{v.label}</p>
      {grading.feedback && <p className="text-body-lg">{grading.feedback}</p>}
      <p className="text-meta text-muted">
        {grading.consulted === 0
          ? 'Corregido solo contra la respuesta guardada.'
          : `Corregido contra la respuesta guardada y ${grading.consulted} documentos del Board. Confianza ${CONFIDENCE[grading.confidence]}.`}
      </p>
      {grading.argument && (
        <div className="rounded-card border border-warning/50 px-3 py-2 text-body-lg">
          <b className="mb-0.5 block text-meta font-semibold text-warning">
            No está del todo claro
          </b>
          {grading.argument}
        </div>
      )}
      {grading.referenceIssue && (
        <div className="rounded-card border border-border px-3 py-2 text-body-lg">
          <b className="mb-0.5 block text-meta font-semibold text-muted">
            La respuesta guardada podría tener un problema
          </b>
          {grading.referenceIssue}
        </div>
      )}
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
      <Sources items={grading.sources} />
      {revision && <Revise grading={grading} {...revision} />}
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
