import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { DeckSummary } from '@shared/flashcards'
import {
  DEFAULT_DECK_OPTIONS,
  RETENTION_RANGE,
  formatSteps,
  intervalFor,
  parseSteps,
  type DeckOptions
} from '@shared/srs'
import { errorMessage, queryKeys } from '../../lib/api'
import { Modal } from '../Modal'
import { Button } from '../Button'
import { Label, TextArea, TextInput } from '../Field'
import { useToast } from '../Toast'

/** Criar (deck `null`) ou editar um baralho. */
export function DeckDialog({ open, deck, onClose, onSaved }: {
  open: boolean
  deck: DeckSummary | null
  onClose: () => void
  onSaved?: (deckId: number) => void
}) {
  return (
    <Modal open={open} onClose={onClose} title={deck ? 'Editar baralho' : 'Novo baralho'}>
      {open && <DeckForm key={deck?.id ?? 'novo'} deck={deck} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  )
}

function DeckForm({ deck, onClose, onSaved }: { deck: DeckSummary | null; onClose: () => void; onSaved?: (id: number) => void }) {
  const [title, setTitle] = useState(deck?.title ?? '')
  const [description, setDescription] = useState(deck?.description ?? '')
  const [options, setOptions] = useState<DeckOptions>(deck?.options ?? DEFAULT_DECK_OPTIONS)
  const [learning, setLearning] = useState(formatSteps(options.learningStepsMin))
  const [relearning, setRelearning] = useState(formatSteps(options.relearningStepsMin))
  const queryClient = useQueryClient()
  const toast = useToast()

  const learningSteps = parseSteps(learning)
  const relearningSteps = parseSteps(relearning)
  const valid = Boolean(title.trim()) && learningSteps !== null && relearningSteps !== null

  const save = useMutation({
    mutationFn: async () => {
      const full: DeckOptions = { ...options, learningStepsMin: learningSteps ?? [], relearningStepsMin: relearningSteps ?? [] }
      if (deck) {
        await window.api.decks.update(deck.id, { title, description, options: full })
        return deck.id
      }
      return window.api.decks.create({ title, description, options: full })
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.decks })
      onClose()
      onSaved?.(id)
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <div>
        <Label htmlFor="deck-title">Nome</Label>
        <TextInput id="deck-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Cálculo I" data-autofocus />
      </div>
      <div>
        <Label htmlFor="deck-description">Descrição</Label>
        <TextArea id="deck-description" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <DeckOptionsFields
        options={options}
        onChange={(patch) => setOptions((o) => ({ ...o, ...patch }))}
        learning={learning}
        relearning={relearning}
        onLearning={setLearning}
        onRelearning={setRelearning}
        onReset={() => {
          setOptions(DEFAULT_DECK_OPTIONS)
          setLearning(formatSteps(DEFAULT_DECK_OPTIONS.learningStepsMin))
          setRelearning(formatSteps(DEFAULT_DECK_OPTIONS.relearningStepsMin))
        }}
        learningError={learningSteps === null}
        relearningError={relearningSteps === null}
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!valid || save.isPending}>
          {deck ? 'Salvar' : 'Criar'}
        </Button>
      </div>
    </form>
  )
}

const percent = (n: number) => `${Math.round(n * 100)}%`

/** Opções de estudo do baralho (FSRS), recolhidas por padrão. */
function DeckOptionsFields({
  options,
  onChange,
  learning,
  relearning,
  onLearning,
  onRelearning,
  onReset,
  learningError,
  relearningError
}: {
  options: DeckOptions
  onChange: (patch: Partial<DeckOptions>) => void
  learning: string
  relearning: string
  onLearning: (value: string) => void
  onRelearning: (value: string) => void
  onReset: () => void
  learningError: boolean
  relearningError: boolean
}) {
  const number = (value: string, fallback: number) => (value.trim() === '' || !Number.isFinite(Number(value)) ? fallback : Number(value))
  const example = Math.round(intervalFor(10, options.desiredRetention))
  return (
    <details className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">Opções de estudo</summary>
      <div className="mt-3 space-y-4">
        <div>
          <Label htmlFor="deck-retention">Retenção desejada · {percent(options.desiredRetention)}</Label>
          <input
            id="deck-retention"
            type="range"
            min={RETENTION_RANGE.min * 100}
            max={RETENTION_RANGE.max * 100}
            step={1}
            value={Math.round(options.desiredRetention * 100)}
            onChange={(e) => onChange({ desiredRetention: Number(e.target.value) / 100 })}
            className="w-full accent-[var(--accent)]"
          />
          <p className="mt-1 text-xs text-muted">
            Chance de lembrar quando a carta voltar. 90% é o recomendado; mais alto traz mais revisões por dia. Ex.: uma
            carta que você lembraria por 10 dias volta em {example} {example === 1 ? 'dia' : 'dias'}.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="deck-new">Novas por dia</Label>
            <TextInput
              id="deck-new"
              type="number"
              min={0}
              max={9999}
              value={options.newPerDay}
              onChange={(e) => onChange({ newPerDay: Math.max(0, Math.round(number(e.target.value, 0))) })}
            />
          </div>
          <div>
            <Label htmlFor="deck-reviews">Revisões por dia</Label>
            <TextInput
              id="deck-reviews"
              type="number"
              min={0}
              max={99999}
              value={options.reviewsPerDay}
              onChange={(e) => onChange({ reviewsPerDay: Math.max(0, Math.round(number(e.target.value, 0))) })}
            />
          </div>
          <div>
            <Label htmlFor="deck-learning">Etapas de aprendizado</Label>
            <TextInput
              id="deck-learning"
              value={learning}
              onChange={(e) => onLearning(e.target.value)}
              placeholder="1m 10m"
              aria-invalid={learningError}
              className={learningError ? 'border-red-400' : ''}
            />
          </div>
          <div>
            <Label htmlFor="deck-relearning">Etapas ao errar</Label>
            <TextInput
              id="deck-relearning"
              value={relearning}
              onChange={(e) => onRelearning(e.target.value)}
              placeholder="10m"
              aria-invalid={relearningError}
              className={relearningError ? 'border-red-400' : ''}
            />
          </div>
          <div>
            <Label htmlFor="deck-max">Intervalo máximo (dias)</Label>
            <TextInput
              id="deck-max"
              type="number"
              min={1}
              max={36500}
              value={options.maxIntervalDays}
              onChange={(e) => onChange({ maxIntervalDays: Math.min(36500, Math.max(1, Math.round(number(e.target.value, 36500)))) })}
            />
          </div>
        </div>
        <p className="text-xs text-muted">
          Etapas em minutos (m), horas (h) ou 1 dia (1d), separadas por espaço. As mudanças valem a partir da próxima
          resposta de cada carta.
        </p>
        <Button variant="ghost" onClick={onReset}>
          Restaurar padrão
        </Button>
      </div>
    </details>
  )
}
