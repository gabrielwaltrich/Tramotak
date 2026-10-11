import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileUp, Layers, Loader2, MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import type { DeckSummary } from '@shared/flashcards'
import { plural } from '@shared/format'
import { errorMessage, queryKeys } from '../lib/api'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { Button } from '../components/Button'
import { Menu } from '../components/Menu'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DeckDialog } from '../components/flashcards/DeckDialog'
import { DeckCounts } from '../components/flashcards/DeckCounts'
import { useToast } from '../components/Toast'

export function FlashcardsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<DeckSummary | null>(null)
  const [deleting, setDeleting] = useState<DeckSummary | null>(null)

  const decks = useQuery({ queryKey: queryKeys.decks, queryFn: () => window.api.decks.list(), staleTime: 0 })

  const importDeck = useMutation({
    mutationFn: () => window.api.decks.importFile(),
    onSuccess: async (result) => {
      if (!result) return
      await queryClient.invalidateQueries({ queryKey: queryKeys.decks })
      toast(
        `“${result.deckTitle}”: ${plural(result.imported, 'carta importada', 'cartas importadas')}` +
          (result.skipped ? ` (${plural(result.skipped, 'repetida')} pulada${result.skipped > 1 ? 's' : ''})` : '')
      )
      navigate(`/flashcards/${result.deckId}`)
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  const remove = useMutation({
    mutationFn: (id: number) => window.api.decks.delete(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.decks })
      toast(`“${deleting?.title}” excluído`)
      setDeleting(null)
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  const list = decks.data ?? []
  const totalDue = list.reduce((n, d) => n + d.newCount + d.learningCount + d.reviewCount, 0)

  return (
    <div className="mx-auto max-w-4xl p-8">
      <PageHeader
        title="Flashcards"
        subtitle={list.length ? `${plural(totalDue, 'carta')} para hoje` : 'Repetição espaçada para fixar o que você estuda'}
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => importDeck.mutate()} disabled={importDeck.isPending}>
              {importDeck.isPending ? <Loader2 size={16} className="animate-spin" /> : <FileUp size={16} />} Importar
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} /> Novo baralho
            </Button>
          </div>
        }
      />

      {decks.isPending ? (
        <div className="grid place-items-center py-20 text-muted">
          <Loader2 className="animate-spin" />
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Layers size={22} />}
          title="Nenhum baralho ainda"
          description="Crie um baralho, importe um do Anki (.apkg) ou transforme suas anotações das aulas em cartas."
          action={<Button onClick={() => setCreating(true)}>Criar baralho</Button>}
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {list.map((deck) => {
            const due = deck.newCount + deck.learningCount + deck.reviewCount
            return (
              <li key={deck.id} className="flex items-center gap-4 px-4 py-3 hover:bg-surface-2/50">
                <button type="button" onClick={() => navigate(`/flashcards/${deck.id}`)} className="min-w-0 flex-1 text-left">
                  <p className="truncate font-medium">{deck.title}</p>
                  <p className="truncate text-xs text-muted">
                    {plural(deck.total, 'carta')}
                    {deck.courseTitle && ` · curso: ${deck.courseTitle}`}
                  </p>
                </button>
                <DeckCounts newCount={deck.newCount} learningCount={deck.learningCount} reviewCount={deck.reviewCount} />
                <Button onClick={() => navigate(`/flashcards/${deck.id}/study`)} disabled={due === 0} className="w-24">
                  Estudar
                </Button>
                <Menu
                  label={`Ações de ${deck.title}`}
                  trigger={<MoreVertical size={16} />}
                  items={[
                    { label: 'Editar', icon: <Pencil size={14} />, onSelect: () => setEditing(deck) },
                    { label: 'Excluir', icon: <Trash2 size={14} />, onSelect: () => setDeleting(deck), danger: true }
                  ]}
                />
              </li>
            )
          })}
        </ul>
      )}

      <DeckDialog open={creating} deck={null} onClose={() => setCreating(false)} onSaved={(id) => navigate(`/flashcards/${id}`)} />
      <DeckDialog open={editing !== null} deck={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        title="Excluir baralho"
        confirmLabel="Excluir"
        busy={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      >
        <p>
          Excluir <strong className="text-text">“{deleting?.title}”</strong> e {plural(deleting?.total ?? 0, 'carta')}? O
          histórico de revisões também será apagado.
        </p>
      </ConfirmDialog>
    </div>
  )
}
