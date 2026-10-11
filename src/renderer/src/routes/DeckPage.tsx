import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, MoreVertical, Pencil, PlayCircle, RotateCcw, Search, Sparkles, Trash2 } from 'lucide-react'
import type { CardView, DeckDetail } from '@shared/flashcards'
import { plural } from '@shared/format'
import { matches } from '@shared/search'
import { formatInterval } from '@shared/srs'
import { errorMessage, queryKeys } from '../lib/api'
import { Button } from '../components/Button'
import { TextArea, TextInput } from '../components/Field'
import { Menu } from '../components/Menu'
import { DeckCounts } from '../components/flashcards/DeckCounts'
import { useToast } from '../components/Toast'

const STATE_LABEL: Record<CardView['state'], string> = {
  new: 'Nova',
  learning: 'Aprendendo',
  relearning: 'Reaprendendo',
  review: 'Revisão'
}

const STATE_COLOR: Record<CardView['state'], string> = {
  new: 'text-sky-400 bg-sky-400/10',
  learning: 'text-orange-400 bg-orange-400/10',
  relearning: 'text-orange-400 bg-orange-400/10',
  review: 'text-success bg-success/10'
}

function dueLabel(card: CardView): string | null {
  if (card.state === 'new') return null
  const diff = card.due - Math.floor(Date.now() / 1000)
  return diff <= 0 ? 'vence agora' : `em ${formatInterval(diff)}`
}

const isSubmit = (e: React.KeyboardEvent) => e.key === 'Enter' && (e.ctrlKey || e.metaKey)

function CardEditor({ initial, submitLabel, onSubmit, onCancel, busy, autoFocus }: {
  initial?: { front: string; back: string }
  submitLabel: string
  onSubmit: (value: { front: string; back: string }) => Promise<unknown>
  onCancel?: () => void
  busy: boolean
  autoFocus?: boolean
}) {
  const [front, setFront] = useState(initial?.front ?? '')
  const [back, setBack] = useState(initial?.back ?? '')
  const frontRef = useRef<HTMLTextAreaElement>(null)

  const submit = async () => {
    if (!front.trim() || busy) return
    await onSubmit({ front, back })
    if (!initial) {
      setFront('')
      setBack('')
      frontRef.current?.focus()
    }
  }

  const keys = (e: React.KeyboardEvent) => {
    if (isSubmit(e)) {
      e.preventDefault()
      void submit()
    }
    if (e.key === 'Escape' && onCancel) {
      e.stopPropagation()
      onCancel()
    }
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2 md:grid-cols-2">
        <TextArea ref={frontRef} value={front} onChange={(e) => setFront(e.target.value)} onKeyDown={keys} placeholder="Frente (pergunta)" aria-label="Frente" autoFocus={autoFocus} className="min-h-20" />
        <TextArea value={back} onChange={(e) => setBack(e.target.value)} onKeyDown={keys} placeholder="Verso (resposta)" aria-label="Verso" className="min-h-20" />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">Ctrl+Enter salva</span>
        <div className="flex gap-2">
          {onCancel && (
            <Button variant="ghost" onClick={onCancel}>
              Cancelar
            </Button>
          )}
          <Button onClick={() => void submit()} disabled={!front.trim() || busy}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

function CardRow({ card, deckId }: { card: CardView; deckId: number }) {
  const [editing, setEditing] = useState(false)
  const queryClient = useQueryClient()
  const toast = useToast()
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.deck(deckId) })

  const update = useMutation({
    mutationFn: (value: { front: string; back: string }) => window.api.cards.update(card.id, value),
    onSuccess: async () => {
      await refresh()
      setEditing(false)
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const remove = useMutation({
    mutationFn: () => window.api.cards.delete(card.id),
    onSuccess: refresh,
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const reset = useMutation({
    mutationFn: () => window.api.cards.reset(card.id),
    onSuccess: async () => {
      await refresh()
      toast('Carta voltou a ser nova')
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  if (editing) {
    return (
      <li className="p-3">
        <CardEditor initial={card} submitLabel="Salvar" busy={update.isPending} onSubmit={(v) => update.mutateAsync(v)} onCancel={() => setEditing(false)} autoFocus />
      </li>
    )
  }

  const due = dueLabel(card)
  return (
    <li className="group grid grid-cols-[1fr_1fr_auto] items-start gap-4 px-4 py-3 hover:bg-surface-2/50">
      <p className="line-clamp-3 text-sm whitespace-pre-wrap">{card.front}</p>
      <p className="line-clamp-3 text-sm whitespace-pre-wrap text-muted">{card.back || '—'}</p>
      <div className="flex items-center gap-2">
        <div className="text-right">
          <span className={`rounded px-1.5 py-0.5 text-xs ${STATE_COLOR[card.state]}`}>{STATE_LABEL[card.state]}</span>
          {due && <p className="mt-1 text-xs text-muted">{due}</p>}
          {card.lessonId !== null && (
            <Link
              to={card.timestampSec !== null ? `/lesson/${card.lessonId}?t=${Math.floor(card.timestampSec)}` : `/lesson/${card.lessonId}`}
              className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline"
              title={card.lessonTitle ?? undefined}
            >
              <PlayCircle size={12} /> aula
            </Link>
          )}
        </div>
        <Menu
          label="Ações da carta"
          trigger={<MoreVertical size={16} />}
          items={[
            { label: 'Editar', icon: <Pencil size={14} />, onSelect: () => setEditing(true) },
            ...(card.state !== 'new' ? [{ label: 'Voltar a ser nova', icon: <RotateCcw size={14} />, onSelect: () => reset.mutate() }] : []),
            { label: 'Excluir', icon: <Trash2 size={14} />, onSelect: () => remove.mutate(), danger: true }
          ]}
        />
      </div>
    </li>
  )
}

export function DeckPage() {
  const deckId = Number(useParams().id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [filter, setFilter] = useState('')

  const deck = useQuery({ queryKey: queryKeys.deck(deckId), queryFn: () => window.api.decks.get(deckId), staleTime: 0 })

  const create = useMutation({
    mutationFn: (value: { front: string; back: string }) => window.api.cards.create({ deckId, ...value }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.deck(deckId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.decks })
      ]),
    onError: (error) => toast(errorMessage(error), 'error')
  })

  const visible = useMemo(() => (deck.data?.cards ?? []).filter((c) => matches(filter, c.front, c.back)), [deck.data, filter])

  if (deck.isPending) {
    return (
      <div className="grid place-items-center py-20 text-muted">
        <Loader2 className="animate-spin" />
      </div>
    )
  }
  if (deck.isError) return <p className="p-8 text-sm text-red-400">{errorMessage(deck.error)}</p>

  const d: DeckDetail = deck.data
  const due = d.newCount + d.learningCount + d.reviewCount

  return (
    <div className="mx-auto max-w-5xl p-8">
      <Link to="/flashcards" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
        <ArrowLeft size={16} /> Flashcards
      </Link>
      <header className="mb-6 flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{d.title}</h1>
          {d.description && <p className="mt-1 text-sm text-muted">{d.description}</p>}
          <div className="mt-2 flex items-center gap-4 text-sm text-muted">
            <span>{plural(d.total, 'carta')}</span>
            <DeckCounts newCount={d.newCount} learningCount={d.learningCount} reviewCount={d.reviewCount} />
          </div>
        </div>
        <Button variant="ghost" onClick={() => navigate(`/ai?deck=${deckId}&task=cards`)}>
          <Sparkles size={16} /> Gerar com IA
        </Button>
        <Button onClick={() => navigate(`/flashcards/${deckId}/study`)} disabled={due === 0}>
          {due === 0 ? 'Nada para hoje' : `Estudar (${due})`}
        </Button>
      </header>

      <section className="mb-6 rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-medium">Nova carta</h2>
        <CardEditor submitLabel="Adicionar" busy={create.isPending} onSubmit={(v) => create.mutateAsync(v)} />
      </section>

      {d.cards.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="flex items-center gap-3 border-b border-border p-3">
            <div className="relative flex-1">
              <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
              <TextInput value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar cartas…" className="pl-9" aria-label="Filtrar cartas" />
            </div>
            <span className="text-xs text-muted">{visible.length === d.cards.length ? plural(d.cards.length, 'carta') : `${visible.length} de ${d.cards.length}`}</span>
          </div>
          <div className="grid grid-cols-[1fr_1fr_auto] gap-4 border-b border-border px-4 py-2 text-xs font-medium tracking-wider text-muted uppercase">
            <span>Frente</span>
            <span>Verso</span>
            <span className="w-28 text-right">Estado</span>
          </div>
          <ul className="divide-y divide-border">
            {visible.map((card) => (
              <CardRow key={card.id} card={card} deckId={deckId} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
