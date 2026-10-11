import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileUp, GitFork, Loader2, MoreVertical, Plus, Trash2 } from 'lucide-react'
import { plural } from '@shared/format'
import { errorMessage } from '../lib/api'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { Button } from '../components/Button'
import { Menu } from '../components/Menu'
import { useToast } from '../components/Toast'
import { NameDialog } from './NotebooksPage'

export function MindmapsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const maps = useQuery({ queryKey: ['mindmaps'], queryFn: () => window.api.mindmaps.list(), staleTime: 0 })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['mindmaps'] })
  const create = useMutation({
    mutationFn: (title: string) => window.api.mindmaps.create(title),
    onSuccess: async (id) => {
      await refresh()
      navigate(`/mindmaps/${id}`)
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const importFile = useMutation({
    mutationFn: () => window.api.mindmaps.importFile(),
    onSuccess: async (id) => {
      if (id === null) return
      await refresh()
      navigate(`/mindmaps/${id}`)
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const remove = useMutation({ mutationFn: (id: number) => window.api.mindmaps.delete(id), onSuccess: refresh })
  const list = maps.data ?? []

  return (
    <div className="mx-auto max-w-4xl p-8">
      <PageHeader
        title="Mapas mentais"
        subtitle="Organize ideias em ramos, ligados às suas aulas"
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => importFile.mutate()}>
              <FileUp size={16} /> Importar
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} /> Novo mapa
            </Button>
          </div>
        }
      />
      {maps.isPending ? (
        <Loader2 className="mx-auto my-20 animate-spin text-muted" />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<GitFork size={22} />}
          title="Nenhum mapa mental"
          description="Comece por um tema central e abra ramos com Tab e Enter."
          action={<Button onClick={() => setCreating(true)}>Criar mapa</Button>}
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {list.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/50">
              <button type="button" onClick={() => navigate(`/mindmaps/${m.id}`)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <GitFork size={18} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{m.title}</span>
                  <span className="text-xs text-muted">
                    {plural(m.nodeCount, 'tópico')} · {new Date(m.updatedAt * 1000).toLocaleDateString('pt-BR')}
                  </span>
                </span>
              </button>
              <Menu label={`Ações de ${m.title}`} trigger={<MoreVertical size={16} />} items={[{ label: 'Excluir', icon: <Trash2 size={14} />, onSelect: () => remove.mutate(m.id), danger: true }]} />
            </li>
          ))}
        </ul>
      )}
      <NameDialog open={creating} title="Novo mapa mental" label="Tema central" submitLabel="Criar" onClose={() => setCreating(false)} onSubmit={(t) => create.mutateAsync(t)} />
    </div>
  )
}
