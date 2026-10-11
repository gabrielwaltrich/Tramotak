import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Clock, Flag, Loader2, RotateCcw, XCircle } from 'lucide-react'
import type { AttemptView } from '@shared/exams'
import { formatClock, plural } from '@shared/format'
import { isAnswered, type QuestionAnswer } from '@shared/questions'
import { errorMessage } from '../lib/api'
import { Button } from '../components/Button'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { RichText } from '../components/RichText'
import { AnswerInput } from '../components/questions/AnswerInput'
import { useToast } from '../components/Toast'

const TEXT_SAVE_DELAY_MS = 600

function GradeBadge({ correct }: { correct: boolean | null | undefined }) {
  if (correct === undefined) return null
  if (correct === null) return <span className="rounded bg-warning/10 px-2 py-0.5 text-xs text-warning">aguardando sua correção</span>
  return correct ? (
    <span className="inline-flex items-center gap-1 rounded bg-success/10 px-2 py-0.5 text-xs text-success">
      <CheckCircle2 size={12} /> certa
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded bg-red-500/10 px-2 py-0.5 text-xs text-red-400">
      <XCircle size={12} /> errada
    </span>
  )
}

/** Cronômetro local, sincronizado com o tempo restante calculado no processo principal. */
function useCountdown(remainingSec: number | null, fetchedAt: number, onZero: () => void): number | null {
  const [left, setLeft] = useState(remainingSec)
  const zeroRef = useRef(onZero)
  useEffect(() => {
    zeroRef.current = onZero
  })
  useEffect(() => {
    if (remainingSec === null) return
    const tick = () => {
      const value = Math.max(0, remainingSec - Math.floor((Date.now() - fetchedAt) / 1000))
      setLeft(value)
      if (value === 0) zeroRef.current()
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [remainingSec, fetchedAt])
  return remainingSec === null ? null : left
}

function Session({ attempt, fetchedAt }: { attempt: AttemptView; fetchedAt: number }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [index, setIndex] = useState(() => Math.max(0, attempt.questions.findIndex((q) => !isAnswered(attempt.answers[q.id]?.answer))))
  const [drafts, setDrafts] = useState<Record<number, QuestionAnswer>>({})
  const [confirming, setConfirming] = useState(false)
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})
  const key = ['attempt', attempt.id]
  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: key }), [queryClient, attempt.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const left = useCountdown(attempt.remainingSec, fetchedAt, refresh)
  const question = attempt.questions[index]
  const state = attempt.answers[question.id]
  const immediate = attempt.settings.feedback === 'immediate'
  const locked = immediate && state?.grade !== undefined
  const current = drafts[question.id] ?? state?.answer ?? null

  const save = useMutation({
    mutationFn: (v: { questionId: number; answer: QuestionAnswer }) => window.api.attempts.answer(attempt.id, v.questionId, v.answer),
    onSuccess: (_r, v) => {
      if (immediate) {
        setDrafts((d) => {
          const next = { ...d }
          delete next[v.questionId]
          return next
        })
      }
      return refresh()
    },
    onError: (error) => {
      toast(errorMessage(error), 'error')
      return refresh()
    }
  })

  const mark = useMutation({
    mutationFn: (marked: boolean) => window.api.attempts.mark(attempt.id, question.id, marked),
    onSuccess: refresh
  })

  const submit = useMutation({
    mutationFn: () => window.api.attempts.submit(attempt.id),
    onSuccess: refresh,
    onError: (error) => toast(errorMessage(error), 'error')
  })

  // Anti-cola: sair da janela durante a prova fica registrado.
  useEffect(() => {
    const onBlur = () => {
      window.api.attempts
        .focusLoss(attempt.id)
        .then((n) => toast(`Você saiu da janela da prova (${plural(n, 'vez', 'vezes')}). Isso fica registrado no resultado.`, 'error'))
        .catch(() => {})
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [attempt.id, toast])

  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), [])

  /** No modo "corrigir ao enviar", salva sozinho (textos com um pequeno atraso). */
  const change = (answer: QuestionAnswer) => {
    setDrafts((d) => ({ ...d, [question.id]: answer }))
    if (immediate) return
    clearTimeout(timers.current[question.id])
    const qid = question.id
    if (answer.type === 'short' || answer.type === 'essay') {
      timers.current[qid] = setTimeout(() => save.mutate({ questionId: qid, answer }), TEXT_SAVE_DELAY_MS)
    } else save.mutate({ questionId: qid, answer })
  }

  const flushText = () => {
    const pending = drafts[question.id]
    if (!immediate && pending && timers.current[question.id]) {
      clearTimeout(timers.current[question.id])
      delete timers.current[question.id]
      save.mutate({ questionId: question.id, answer: pending })
    }
  }

  const go = (i: number) => {
    flushText()
    setIndex(i)
  }

  const answeredCount = attempt.questions.filter((q) => isAnswered(drafts[q.id] ?? attempt.answers[q.id]?.answer)).length
  const markedCount = attempt.questions.filter((q) => attempt.answers[q.id]?.marked).length
  const unanswered = attempt.questions.length - answeredCount
  const canBack = attempt.settings.allowBack && index > 0

  return (
    <div className="mx-auto max-w-4xl p-8">
      <header className="mb-5 flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">Simulado</p>
          <h1 className="truncate text-lg font-semibold">{attempt.examTitle}</h1>
        </div>
        {attempt.focusLosses > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs text-warning" title="Saídas da janela durante a prova">
            <AlertTriangle size={14} /> {attempt.focusLosses}
          </span>
        )}
        {left !== null && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium tabular-nums ${left <= 60 ? 'border-red-500/50 text-red-400' : 'border-border'}`}
            role="timer"
            aria-label="Tempo restante"
          >
            <Clock size={14} /> {formatClock(left)}
          </span>
        )}
        <Button onClick={() => (flushText(), setConfirming(true))}>Enviar prova</Button>
      </header>

      <div className="mb-2 flex items-center justify-between text-sm text-muted">
        <span>
          Questão {index + 1} de {attempt.questions.length}
          {question.topic && ` · ${question.topic}`} · {plural(question.points, 'ponto')}
        </span>
        <span>{plural(answeredCount, 'respondida')}</span>
      </div>
      <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${((index + 1) / attempt.questions.length) * 100}%` }} />
      </div>

      <article className="rounded-xl border border-border bg-surface p-6">
        <p className="mb-5 text-base leading-relaxed">
          <RichText text={question.statement} />
        </p>
        <AnswerInput question={question} answer={current} onChange={change} readOnly={locked} />

        {immediate && !locked && (
          <div className="mt-4 flex justify-end">
            <Button onClick={() => current && save.mutate({ questionId: question.id, answer: current })} disabled={!isAnswered(current) || save.isPending}>
              Responder
            </Button>
          </div>
        )}
        {locked && (
          <div className="mt-4 space-y-2 border-t border-border pt-4">
            <GradeBadge correct={state.grade?.correct} />
            {question.explanation && (
              <p className="text-sm text-muted">
                <RichText text={question.explanation} />
              </p>
            )}
          </div>
        )}
      </article>

      <div className="mt-4 flex items-center gap-2">
        <Button variant="ghost" onClick={() => go(index - 1)} disabled={!canBack}>
          <ChevronLeft size={16} /> Anterior
        </Button>
        <button
          type="button"
          onClick={() => mark.mutate(!state?.marked)}
          aria-pressed={state?.marked ?? false}
          className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm ${state?.marked ? 'border-warning/50 bg-warning/10 text-warning' : 'border-border text-muted hover:text-text'}`}
        >
          <Flag size={14} /> {state?.marked ? 'Marcada para revisar' : 'Marcar para revisar'}
        </button>
        <span className="flex-1" />
        {index < attempt.questions.length - 1 ? (
          <Button onClick={() => go(index + 1)}>
            Próxima <ChevronRight size={16} />
          </Button>
        ) : (
          <Button onClick={() => (flushText(), setConfirming(true))}>Enviar prova</Button>
        )}
      </div>

      <nav aria-label="Mapa de questões" className="mt-6 flex flex-wrap gap-1.5">
        {attempt.questions.map((q, i) => {
          const s = attempt.answers[q.id]
          const answered = isAnswered(drafts[q.id] ?? s?.answer)
          const reachable = attempt.settings.allowBack || i >= index
          return (
            <button
              key={q.id}
              type="button"
              onClick={() => reachable && go(i)}
              disabled={!reachable}
              aria-current={i === index ? 'step' : undefined}
              aria-label={`Questão ${i + 1}${answered ? ', respondida' : ''}${s?.marked ? ', marcada' : ''}`}
              className={`relative grid size-9 place-items-center rounded-md border text-xs tabular-nums disabled:opacity-40 ${
                i === index ? 'border-accent ring-2 ring-accent/40' : 'border-border'
              } ${answered ? 'bg-accent-soft text-accent' : 'text-muted'}`}
            >
              {i + 1}
              {s?.marked && <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-warning" />}
            </button>
          )
        })}
      </nav>

      <ConfirmDialog
        open={confirming}
        title="Enviar prova"
        confirmLabel="Enviar"
        busy={submit.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          submit.mutate()
        }}
      >
        <p>Depois de enviar não dá para mudar as respostas.</p>
        {unanswered > 0 && <p className="mt-2 text-warning">{plural(unanswered, 'questão sem resposta', 'questões sem resposta')} (valem zero).</p>}
        {markedCount > 0 && <p className="mt-2 text-warning">{plural(markedCount, 'questão marcada', 'questões marcadas')} para revisar.</p>}
      </ConfirmDialog>
    </div>
  )
}

function Result({ attempt }: { attempt: AttemptView }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const r = attempt.result!
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['attempt', attempt.id] })

  const gradeEssay = useMutation({
    mutationFn: (v: { questionId: number; correct: boolean }) => window.api.attempts.gradeEssay(attempt.id, v.questionId, v.correct),
    onSuccess: refresh,
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const retry = useMutation({
    mutationFn: () => window.api.attempts.start(attempt.examId),
    onSuccess: (id) => navigate(`/questions/attempt/${id}`),
    onError: (error) => toast(errorMessage(error), 'error')
  })

  return (
    <div className="mx-auto max-w-4xl p-8">
      <Link to={`/questions/${attempt.bankId}`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
        <ArrowLeft size={16} /> Voltar ao banco
      </Link>

      <section className="mb-6 flex flex-wrap items-center gap-6 rounded-xl border border-border bg-surface p-6">
        <div>
          <p className="text-sm text-muted">{attempt.examTitle}</p>
          <p className="mt-1 text-5xl font-semibold tracking-tight tabular-nums">{r.percent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</p>
          <p className={`mt-2 inline-flex items-center gap-1.5 text-sm font-medium ${r.passed ? 'text-success' : 'text-red-400'}`}>
            {r.passed ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            {r.passed ? 'Aprovado' : 'Reprovado'} (corte {attempt.settings.passPercent}%)
          </p>
        </div>
        <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">Pontos</dt>
            <dd className="font-medium tabular-nums">
              {r.score.toLocaleString('pt-BR')} de {r.maxScore.toLocaleString('pt-BR')}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Certas · erradas</dt>
            <dd className="font-medium tabular-nums">
              {r.correctCount} · {r.wrongCount}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Tempo</dt>
            <dd className="font-medium tabular-nums">{formatClock(r.durationSec)}</dd>
          </div>
          {r.pendingCount > 0 && (
            <div>
              <dt className="text-muted">Para corrigir</dt>
              <dd className="font-medium text-warning">{plural(r.pendingCount, 'dissertativa')}</dd>
            </div>
          )}
          <div>
            <dt className="text-muted">Saídas da janela</dt>
            <dd className={`font-medium ${attempt.focusLosses ? 'text-warning' : ''}`}>{attempt.focusLosses}</dd>
          </div>
        </dl>
        <Button onClick={() => retry.mutate()} disabled={retry.isPending}>
          <RotateCcw size={16} /> Refazer
        </Button>
      </section>

      <ol className="space-y-4">
        {attempt.questions.map((q, i) => {
          const s = attempt.answers[q.id]
          return (
            <li key={q.id} className="rounded-xl border border-border bg-surface p-5">
              <div className="mb-3 flex items-center gap-3 text-xs text-muted">
                <span className="font-medium text-text">Questão {i + 1}</span>
                {q.topic && <span>{q.topic}</span>}
                <span>
                  {(s?.grade?.points ?? 0).toLocaleString('pt-BR')}/{plural(q.points, 'ponto')}
                </span>
                <span className="flex-1" />
                <GradeBadge correct={s?.grade?.correct} />
              </div>
              <p className="mb-4 leading-relaxed">
                <RichText text={q.statement} />
              </p>
              <AnswerInput question={q} answer={s?.answer ?? null} onChange={() => {}} readOnly />
              {!isAnswered(s?.answer) && <p className="mt-2 text-sm text-muted">Sem resposta.</p>}
              {q.type === 'essay' && isAnswered(s?.answer) && (
                <div className="mt-3 flex items-center gap-2 text-sm">
                  <span className="text-muted">Sua avaliação:</span>
                  <Button variant={s?.grade?.correct === true ? 'primary' : 'ghost'} className="h-8" onClick={() => gradeEssay.mutate({ questionId: q.id, correct: true })}>
                    Certa
                  </Button>
                  <Button variant={s?.grade?.correct === false ? 'danger' : 'ghost'} className="h-8" onClick={() => gradeEssay.mutate({ questionId: q.id, correct: false })}>
                    Errada
                  </Button>
                </div>
              )}
              {q.explanation && (
                <div className="mt-4 rounded-lg bg-surface-2 p-3 text-sm">
                  <p className="mb-1 text-xs text-muted">Explicação</p>
                  <RichText text={q.explanation} />
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export function AttemptPage() {
  const id = Number(useParams().id)
  const attempt = useQuery({ queryKey: ['attempt', id], queryFn: () => window.api.attempts.get(id), staleTime: 0, gcTime: 0 })
  const queryClient = useQueryClient()

  // Ao sair, listas e desempenho do banco precisam dos números novos.
  useEffect(
    () => () => {
      void queryClient.invalidateQueries({ queryKey: ['exams'] })
      void queryClient.invalidateQueries({ queryKey: ['banks'] })
      void queryClient.invalidateQueries({ queryKey: ['bank-analytics'] })
    },
    [queryClient]
  )

  if (attempt.isPending) return <Loader2 className="mx-auto my-20 animate-spin text-muted" />
  if (attempt.isError) return <p className="p-8 text-sm text-red-400">{errorMessage(attempt.error)}</p>
  return attempt.data.status === 'in_progress' ? (
    <Session key={attempt.data.id} attempt={attempt.data} fetchedAt={attempt.dataUpdatedAt} />
  ) : (
    <Result attempt={attempt.data} />
  )
}
