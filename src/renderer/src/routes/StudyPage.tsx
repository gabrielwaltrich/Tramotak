import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, PartyPopper, PlayCircle } from 'lucide-react'
import type { StudyCard } from '@shared/flashcards'
import { formatInterval, type Rating } from '@shared/srs'
import { errorMessage, queryKeys } from '../lib/api'
import { Button } from '../components/Button'
import { DeckCounts } from '../components/flashcards/DeckCounts'
import { useToast } from '../components/Toast'

const ANSWERS: { rating: Rating; label: string; className: string }[] = [
  { rating: 1, label: 'Errei', className: 'border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20' },
  { rating: 2, label: 'Difícil', className: 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/20' },
  { rating: 3, label: 'Bom', className: 'border-success/40 bg-success/10 text-success hover:bg-success/20' },
  { rating: 4, label: 'Fácil', className: 'border-sky-400/40 bg-sky-400/10 text-sky-400 hover:bg-sky-400/20' }
]

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

function queueOf(study: StudyCard): 'new' | 'learning' | 'review' {
  const s = study.card.state
  return s === 'new' ? 'new' : s === 'review' ? 'review' : 'learning'
}

function Finished({ deckId, nextLearningAt, fetchedAt, onRefresh }: {
  deckId: number
  nextLearningAt: number | null
  /** Momento (ms) em que a fila foi lida: referência estável para o texto. */
  fetchedAt: number
  onRefresh: () => void
}) {
  // Quando ainda há cartas em aprendizado para mais tarde, recarrega sozinho na hora certa.
  useEffect(() => {
    if (nextLearningAt === null) return
    const wait = Math.max(1000, nextLearningAt * 1000 - Date.now())
    const timer = setTimeout(onRefresh, Math.min(wait, 2 ** 31 - 1))
    return () => clearTimeout(timer)
  }, [nextLearningAt, onRefresh])

  return (
    <div className="flex flex-col items-center rounded-xl border border-border bg-surface px-6 py-14 text-center">
      <div className="mb-4 grid size-14 place-items-center rounded-full bg-success/10 text-success">
        <PartyPopper size={26} />
      </div>
      {nextLearningAt !== null ? (
        <>
          <h2 className="text-lg font-medium">Pausa curta</h2>
          <p className="mt-1 max-w-sm text-sm text-muted">
            As cartas que você está aprendendo voltam em {formatInterval(nextLearningAt - Math.floor(fetchedAt / 1000))}. Esta tela atualiza sozinha.
          </p>
        </>
      ) : (
        <>
          <h2 className="text-lg font-medium">Parabéns! Você terminou este baralho por hoje.</h2>
          <p className="mt-1 max-w-sm text-sm text-muted">Volte amanhã para as próximas revisões.</p>
        </>
      )}
      <div className="mt-5 flex gap-2">
        <Link to={`/flashcards/${deckId}`}>
          <Button variant="ghost">Ver baralho</Button>
        </Link>
        <Link to="/flashcards">
          <Button>Outros baralhos</Button>
        </Link>
      </div>
    </div>
  )
}

export function StudyPage() {
  const deckId = Number(useParams().id)
  const queryClient = useQueryClient()
  const toast = useToast()
  const [revealed, setRevealed] = useState(false)
  const shownAt = useRef(0)

  const deck = useQuery({ queryKey: queryKeys.deck(deckId), queryFn: () => window.api.decks.get(deckId) })
  const study = useQuery({ queryKey: queryKeys.study(deckId), queryFn: () => window.api.study.next(deckId), staleTime: 0, gcTime: 0 })
  const current = study.data?.next ?? null
  const cardId = current?.card.id

  // Cronometra cada carta a partir do momento em que aparece.
  useEffect(() => {
    shownAt.current = Date.now()
  }, [cardId])

  // Ao sair, a lista de baralhos e o Início precisam dos números novos.
  useEffect(
    () => () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.decks })
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
    [queryClient]
  )

  const answer = useMutation({
    mutationFn: (rating: Rating) => window.api.study.answer(cardId!, rating, Date.now() - shownAt.current),
    onSuccess: async () => {
      setRevealed(false)
      await queryClient.invalidateQueries({ queryKey: queryKeys.study(deckId) })
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  const refresh = useCallback(() => void queryClient.invalidateQueries({ queryKey: queryKeys.study(deckId) }), [queryClient, deckId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || !current || answer.isPending) return
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault()
        setRevealed(true)
      } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault()
        answer.mutate(Number(e.key) as Rating)
      } else if (revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault() // como no Anki: Espaço depois de revelar = Bom
        answer.mutate(3)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, revealed, answer])

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <Link to={`/flashcards/${deckId}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
          <ArrowLeft size={16} /> {deck.data?.title ?? 'Baralho'}
        </Link>
        {current && <DeckCounts {...current.counts} highlight={queueOf(current)} />}
      </div>

      {study.isPending ? (
        <div className="grid place-items-center py-20 text-muted">
          <Loader2 className="animate-spin" />
        </div>
      ) : study.isError ? (
        <p className="text-sm text-red-400">{errorMessage(study.error)}</p>
      ) : !current ? (
        <Finished deckId={deckId} nextLearningAt={study.data.nextLearningAt} fetchedAt={study.dataUpdatedAt} onRefresh={refresh} />
      ) : (
        <>
          <article className="rounded-xl border border-border bg-surface">
            <div className="px-8 py-10 text-center">
              <p className="text-xl leading-relaxed whitespace-pre-wrap select-text">{current.card.front}</p>
            </div>
            {revealed && (
              <div className="border-t border-border px-8 py-8 text-center">
                <p className="text-lg leading-relaxed whitespace-pre-wrap text-text/90 select-text">{current.card.back || '—'}</p>
                {current.card.lessonId !== null && (
                  <Link
                    to={
                      current.card.timestampSec !== null
                        ? `/lesson/${current.card.lessonId}?t=${Math.floor(current.card.timestampSec)}`
                        : `/lesson/${current.card.lessonId}`
                    }
                    className="mt-4 inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
                  >
                    <PlayCircle size={14} /> Ver na aula{current.card.lessonTitle ? `: ${current.card.lessonTitle}` : ''}
                  </Link>
                )}
              </div>
            )}
          </article>

          <div className="mt-5">
            {!revealed ? (
              <Button onClick={() => setRevealed(true)} className="h-12 w-full text-base">
                Mostrar resposta <kbd className="ml-2 rounded border border-white/30 px-1.5 text-xs">Espaço</kbd>
              </Button>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {ANSWERS.map((a) => (
                  <button
                    key={a.rating}
                    type="button"
                    onClick={() => answer.mutate(a.rating)}
                    disabled={answer.isPending}
                    className={`flex h-16 flex-col items-center justify-center rounded-lg border text-sm font-medium transition disabled:opacity-50 ${a.className}`}
                  >
                    {a.label}
                    <span className="mt-0.5 text-xs font-normal opacity-80">
                      {formatInterval(current.intervals[a.rating])} · {a.rating}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
