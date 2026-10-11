import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, NotebookPen, Plus } from 'lucide-react'
import { plural } from '@shared/format'
import { errorMessage } from '../lib/api'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { Label, TextInput } from '../components/Field'
import { useToast } from '../components/Toast'

/** Diálogo simples de nome, usado por cadernos e mapas. */
export function NameDialog({ open, title, label, initial = '', submitLabel, onClose, onSubmit }: {
  open: boolean
  title: string
  label: string
  initial?: string
  submitLabel: string
  onClose: () => void
  onSubmit: (name: string) => Promise<unknown>
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {open && <NameForm label={label} initial={initial} submitLabel={submitLabel} onClose={onClose} onSubmit={onSubmit} />}
    </Modal>
  )
}

function NameForm({ label, initial, submitLabel, onClose, onSubmit }: { label: string; initial: string; submitLabel: string; onClose: () => void; onSubmit: (name: string) => Promise<unknown> }) {
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try {
          await onSubmit(name)
          onClose()
        } finally {
          setBusy(false)
        }
      }}
    >
      <div>
        <Label htmlFor="name-input">{label}</Label>
        <TextInput id="name-input" value={name} onChange={(e) => setName(e.target.value)} data-autofocus />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!name.trim() || busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

export function NotebooksPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const notebooks = useQuery({ queryKey: ['notebooks'], queryFn: () => window.api.notebooks.list(), staleTime: 0 })
  const create = useMutation({
    mutationFn: (title: string) => window.api.notebooks.create(title),
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ['notebooks'] })
      navigate(`/notebooks/${id}`)
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const list = notebooks.data ?? []

  return (
    <div className="mx-auto max-w-4xl p-8">
      <PageHeader
        title="Cadernos"
        subtitle="Anotações com texto, fórmulas, desenhos e links para o seu material"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} /> Novo caderno
          </Button>
        }
      />
      {notebooks.isPending ? (
        <Loader2 className="mx-auto my-20 animate-spin text-muted" />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<NotebookPen size={22} />}
          title="Nenhum caderno ainda"
          description="Crie um caderno para resumir aulas em Markdown, escrever fórmulas e desenhar à mão."
          action={<Button onClick={() => setCreating(true)}>Criar caderno</Button>}
        />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
          {list.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => navigate(`/notebooks/${n.id}`)} className="flex h-full w-full flex-col rounded-xl border border-border bg-surface p-4 text-left hover:border-accent/50">
                <NotebookPen size={20} className="mb-3 text-accent" />
                <span className="line-clamp-2 font-medium">{n.title}</span>
                <span className="mt-1 text-xs text-muted">
                  {plural(n.pageCount, 'página')} · {new Date(n.updatedAt * 1000).toLocaleDateString('pt-BR')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <NameDialog open={creating} title="Novo caderno" label="Nome" submitLabel="Criar" onClose={() => setCreating(false)} onSubmit={(t) => create.mutateAsync(t)} />
    </div>
  )
}
