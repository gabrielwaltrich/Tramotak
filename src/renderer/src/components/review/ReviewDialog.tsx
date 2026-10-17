import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronRight, Layers, Loader2, RotateCcw, Sparkles, X } from 'lucide-react'
import type { AttemptQuestion } from '@shared/exams'
import { grade, type QuestionAnswer, type QuestionInput } from '@shared/questions'
import { correctAnswerText, reviewCard, reviewScore, type LessonReview } from '@shared/review'
import { errorMessage, queryKeys } from '../../lib/api'
import { useMediaJobs } from '../../lib/useMediaJobs'
import { AnswerInput } from '../questions/AnswerInput'
import { Button } from '../Button'
import { Modal } from '../Modal'
import { RichText } from '../RichText'
import { useToast } from '../Toast'

type Phase =
  | { kind: 'loading' }
  | { kind: 'transcribing'; jobId: number }
  | { kind: 'generating' }
  | { kind: 'error'; message: string }
  | { kind: 'quiz' }
  | { kind: 'result' }

/** Teclas que o player usa: com a revisão aberta, ficam com ela. */
const PLAYER_KEYS = new Set([' ', 'k', 'm', 'f', 'p', 'N', '[', ']', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

const asAttempt = (q: QuestionInput, i: number, revealed: boolean): AttemptQuestion => ({
  id: i,
  type: q.type,
  statement: q.statement,
  options: q.options,
  topic: q.topic,
  points: q.points,
  ...(revealed ? { key: q.key, explanation: q.explanation } : {})
})

/**
 * Revisão pós-aula: gera (ou retoma) as perguntas da aula, corrige cada uma na hora e, no fim, transforma as
 * erradas em flashcards no baralho do curso. Sem material, transcreve o vídeo antes (se houver provedor).
 */
export function ReviewDialog({ open, lessonId, courseId, onClose, nextTitle, onNext }: {
  open: boolean
  lessonId: number
  courseId: number
  onClose: () => void
  nextTitle?: string
  onNext?: () => void
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const jobs = useMediaJobs()
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [review, setReview] = useState<LessonReview | null>(null)
  const [index, setIndex] = useState(0)
  const [created, setCreated] = useState<Set<number>>(new Set())
  const [creating, setCreating] = useState(false)
  // Respostas que chegam depois de fechar a janela não mudam mais nada.
  const active = useRef(false)

  const refreshStatus = useCallback(() => queryClient.invalidateQueries({ queryKey: ['review', lessonId] }), [queryClient, lessonId])

  const show = useCallback((r: LessonReview) => {
    setReview(r)
    const pending = r.answers.findIndex((a) => a === null)
    if (r.finishedAt !== null || pending < 0) setPhase({ kind: 'result' })
    else {
      setIndex(pending)
      setPhase({ kind: 'quiz' })
    }
  }, [])

  const generate = useCallback(async () => {
    setPhase({ kind: 'generating' })
    setCreated(new Set())
    try {
      const r = await window.api.review.generate(lessonId)
      if (!active.current) return
      show(r)
      void refreshStatus()
    } catch (error) {
      if (active.current) setPhase({ kind: 'error', message: errorMessage(error) })
    }
  }, [lessonId, show, refreshStatus])

  // Retoma a revisão salva ou prepara uma nova (transcrevendo antes, se for o caso).
  const start = useCallback(async () => {
    try {
      const saved = await window.api.review.get(lessonId)
      if (!active.current) return
      if (saved) return show(saved)
      const status = await window.api.review.status(lessonId)
      if (!active.current) return
      if (!status.ai) return setPhase({ kind: 'error', message: 'Escolha um provedor de IA em Configurações → Inteligência artificial.' })
      if (status.material === 'none') {
        return setPhase({ kind: 'error', message: 'Esta aula não tem transcrição, legenda ou texto para a IA ler. Configure a transcrição em Configurações.' })
      }
      if (status.material === 'transcribe') {
        const job = await window.api.media.enqueue('transcribe', lessonId)
        if (active.current) setPhase({ kind: 'transcribing', jobId: job.id })
        return
      }
      await generate()
    } catch (error) {
      if (active.current) setPhase({ kind: 'error', message: errorMessage(error) })
    }
  }, [lessonId, show, generate])

  useEffect(() => {
    if (!open) return
    active.current = true
    // `start` só muda o estado depois do primeiro await (a regra não enxerga isso).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void start()
    return () => {
      active.current = false
      void window.api.review.cancel().catch(() => {})
    }
  }, [open, start])

  // Transcrevendo: quando termina, gera as perguntas.
  const transcribing = phase.kind === 'transcribing' ? phase.jobId : null
  const job = transcribing !== null ? jobs.find((j) => j.id === transcribing) : undefined
  useEffect(() => {
    if (transcribing === null) return
    return window.api.media.onJobs((list) => {
      const j = list.find((x) => x.id === transcribing)
      if (!j || !active.current) return
      if (j.status === 'done') void generate()
      else if (j.status === 'error') setPhase({ kind: 'error', message: j.error ?? 'A transcrição falhou' })
      else if (j.status === 'canceled') setPhase({ kind: 'error', message: 'A transcrição foi cancelada.' })
    })
  }, [transcribing, generate])

  const question = review?.questions[index]
  const answer = review?.answers[index] ?? null
  const revealed = answer !== null
  const total = review?.questions.length ?? 0

  const choose = async (a: QuestionAnswer) => {
    if (!review || revealed) return
    const answers = review.answers.map((x, i) => (i === index ? a : x))
    setReview({ ...review, answers })
    try {
      const saved = await window.api.review.answer(lessonId, answers)
      if (active.current) setReview(saved)
      if (saved.finishedAt !== null) void refreshStatus()
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  const advance = useCallback(() => {
    if (!review) return
    if (index < review.questions.length - 1) setIndex(index + 1)
    else setPhase({ kind: 'result' })
  }, [review, index])

  const restart = async () => {
    try {
      const saved = await window.api.review.answer(lessonId, [])
      setCreated(new Set())
      show(saved)
      void refreshStatus()
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  const makeCards = async (indexes: number[]) => {
    if (!review || creating) return
    setCreating(true)
    try {
      const deckId = await window.api.decks.forCourse(courseId)
      for (const i of indexes) {
        await window.api.cards.create({ deckId, lessonId, ...reviewCard(review.questions[i]) })
        setCreated((s) => new Set(s).add(i))
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.decks })
      toast(indexes.length === 1 ? 'Flashcard criado no baralho do curso' : `${indexes.length} flashcards criados no baralho do curso`, 'success')
    } catch (error) {
      toast(errorMessage(error), 'error')
    } finally {
      setCreating(false)
    }
  }

  // Atalhos: 1–5 escolhem a alternativa (1 = verdadeiro, 2 = falso) e Enter/→ seguem. Com a revisão aberta, as
  // teclas do player (espaço, setas, P…) não chegam a ele.
  useEffect(() => {
    if (!open || phase.kind !== 'quiz' || !question) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && !revealed) {
        if (question.type === 'single' && n <= question.options.length) void choose({ type: 'single', choice: question.options[n - 1].id })
        else if (question.type === 'truefalse' && n <= 2) void choose({ type: 'truefalse', value: n === 1 })
        else return
      } else if ((e.key === 'Enter' || e.key === 'ArrowRight') && revealed && !(e.target instanceof HTMLButtonElement && e.key === 'Enter')) {
        advance()
      } else if (!PLAYER_KEYS.has(e.key)) return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const wrong = review ? review.questions.map((q, i) => (grade(q, review.answers[i]).correct === true ? -1 : i)).filter((i) => i >= 0) : []
  const pendingCards = wrong.filter((i) => !created.has(i))

  const footer =
    phase.kind === 'quiz' && revealed ? (
      <Button onClick={advance} data-autofocus>
        {index < total - 1 ? 'Próxima pergunta' : 'Ver resultado'} <ChevronRight size={16} />
      </Button>
    ) : phase.kind === 'result' ? (
      <>
        <Button variant="ghost" onClick={() => void restart()}>
          <RotateCcw size={16} /> Refazer
        </Button>
        <Button variant="ghost" onClick={() => void generate()}>
          <Sparkles size={16} /> Novas perguntas
        </Button>
        {onNext && nextTitle ? (
          <Button onClick={onNext} title={nextTitle}>
            Próxima aula <ChevronRight size={16} />
          </Button>
        ) : (
          <Button onClick={onClose}>Fechar</Button>
        )}
      </>
    ) : phase.kind === 'error' ? (
      <>
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
        <Button
          onClick={() => {
            setPhase({ kind: 'loading' })
            void start()
          }}
        >
          Tentar de novo
        </Button>
      </>
    ) : undefined

  return (
    <Modal open={open} onClose={onClose} title="Revisão rápida" wide footer={footer}>
      {phase.kind === 'loading' && <Loader2 className="mx-auto my-8 animate-spin text-muted" />}

      {phase.kind === 'transcribing' && (
        <div className="space-y-3 py-6 text-center text-sm">
          <p className="inline-flex items-center gap-2 text-muted">
            <Loader2 size={14} className="animate-spin" />
            {!job || job.status === 'queued' ? 'Na fila para transcrever a aula…' : `Transcrevendo a aula… ${Math.round(job.progress * 100)}%`}
          </p>
          <div className="mx-auto h-1.5 max-w-xs overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round((job?.progress ?? 0) * 100)}%` }} />
          </div>
          <p className="text-xs text-muted">Depois, a IA prepara as perguntas. Se fechar, a transcrição continua e a revisão fica para depois.</p>
        </div>
      )}

      {phase.kind === 'generating' && (
        <div className="space-y-2 py-8 text-center text-sm text-muted">
          <Loader2 className="mx-auto animate-spin" />
          <p>Preparando perguntas sobre o assunto da aula…</p>
        </div>
      )}

      {phase.kind === 'error' && <p className="py-4 text-sm text-red-400">{phase.message}</p>}

      {phase.kind === 'quiz' && question && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs text-muted">
            <span>
              Pergunta {index + 1} de {total}
            </span>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${((index + (revealed ? 1 : 0)) / total) * 100}%` }} />
            </div>
          </div>
          <p className="text-base">
            <RichText text={question.statement} />
          </p>
          <AnswerInput question={asAttempt(question, index, revealed)} answer={answer} onChange={(a) => void choose(a)} readOnly={revealed} />
          {revealed && <Feedback question={question} answer={answer} created={created.has(index)} creating={creating} onCard={() => void makeCards([index])} />}
          {!revealed && <p className="text-xs text-muted">Teclas 1–{question.type === 'truefalse' ? 2 : question.options.length} escolhem a resposta.</p>}
        </div>
      )}

      {phase.kind === 'result' && review && (
        <div className="space-y-4">
          <p className="text-lg font-medium">
            Você acertou {reviewScore(review.questions, review.answers)} de {review.questions.length}.
          </p>
          {wrong.length === 0 ? (
            <p className="text-sm text-muted">Tudo certo. Bom sinal de que o assunto ficou.</p>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <p className="flex-1 text-sm text-muted">Para revisar depois, transforme as erradas em flashcards no baralho do curso.</p>
                {pendingCards.length > 0 && (
                  <Button variant="ghost" onClick={() => void makeCards(pendingCards)} disabled={creating}>
                    <Layers size={16} /> {pendingCards.length === 1 ? 'Criar o flashcard' : `Criar os ${pendingCards.length} flashcards`}
                  </Button>
                )}
              </div>
              <ul className="space-y-2">
                {wrong.map((i) => (
                  <li key={i} className="rounded-lg border border-border p-3 text-sm">
                    <RichText text={review.questions[i].statement} />
                    <p className="mt-2 text-success">
                      <RichText text={correctAnswerText(review.questions[i])} />
                    </p>
                    {created.has(i) && (
                      <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted">
                        <Check size={12} /> Flashcard criado
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}

function Feedback({ question, answer, created, creating, onCard }: {
  question: QuestionInput
  answer: QuestionAnswer | null
  created: boolean
  creating: boolean
  onCard: () => void
}) {
  const right = grade(question, answer).correct === true
  return (
    <div className={`space-y-2 rounded-lg border p-3 text-sm ${right ? 'border-success/40 bg-success/10' : 'border-red-500/40 bg-red-500/10'}`}>
      <p className={`flex items-center gap-1.5 font-medium ${right ? 'text-success' : 'text-red-400'}`}>
        {right ? <Check size={16} /> : <X size={16} />} {right ? 'Certo!' : 'Não foi dessa vez.'}
      </p>
      {question.explanation && (
        <p>
          <RichText text={question.explanation} />
        </p>
      )}
      {!right &&
        (created ? (
          <p className="flex items-center gap-1 text-xs text-muted">
            <Check size={12} /> Flashcard criado
          </p>
        ) : (
          <button type="button" onClick={onCard} disabled={creating} className="flex items-center gap-1.5 text-xs text-accent hover:underline disabled:opacity-50">
            <Layers size={14} /> Virar flashcard
          </button>
        ))}
    </div>
  )
}
