import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { DeckSummary } from '@shared/flashcards'
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
  const queryClient = useQueryClient()
  const toast = useToast()

  const save = useMutation({
    mutationFn: async () => {
      if (deck) {
        await window.api.decks.update(deck.id, { title, description })
        return deck.id
      }
      return window.api.decks.create({ title, description })
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
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!title.trim() || save.isPending}>
          {deck ? 'Salvar' : 'Criar'}
        </Button>
      </div>
    </form>
  )
}
