import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowLeft, ArrowUp, BookOpenText, FileDown, Loader2, MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { errorMessage } from '../lib/api'
import { Button } from '../components/Button'
import { Menu } from '../components/Menu'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { PageEditor } from '../components/notebooks/PageEditor'
import { NotebookReader } from '../components/notebooks/NotebookReader'
import { notebookHtml } from '../components/notebooks/pdf'
import { useToast } from '../components/Toast'
import { NameDialog } from './NotebooksPage'

export function NotebookPage() {
  const notebookId = Number(useParams().id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [selected, setSelected] = useState<number | null>(null)
  const [mode, setMode] = useState<'edit' | 'read'>('edit')
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const notebook = useQuery({ queryKey: ['notebook', notebookId], queryFn: () => window.api.notebooks.get(notebookId), staleTime: 0 })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notebook', notebookId] })

  const pages = notebook.data?.pages ?? []
  const currentId = selected !== null && pages.some((p) => p.id === selected) ? selected : (pages[0]?.id ?? null)

  const addPage = useMutation({
    mutationFn: () => window.api.pages.create(notebookId),
    onSuccess: async (page) => {
      await refresh()
      setSelected(page.id)
      setMode('edit')
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const movePage = useMutation({ mutationFn: (v: { id: number; index: number }) => window.api.pages.move(v.id, v.index), onSuccess: refresh })
  const deletePage = useMutation({
    mutationFn: (id: number) => window.api.pages.delete(id),
    onSuccess: refresh,
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const deleteNotebook = useMutation({
    mutationFn: () => window.api.notebooks.delete(notebookId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['notebooks'] })
      navigate('/notebooks')
    }
  })
  const exportPdf = useMutation({
    mutationFn: async () => {
      const all = await window.api.notebooks.pages(notebookId)
      return window.api.notebooks.exportPdf(notebookId, notebookHtml(notebook.data!.title, all))
    },
    onSuccess: (path) => path && toast(`PDF salvo em ${path.split(/[\\/]/).pop()}`),
    onError: (error) => toast(errorMessage(error), 'error')
  })

  if (notebook.isPending) return <Loader2 className="mx-auto my-20 animate-spin text-muted" />
  if (notebook.isError) return <p className="p-8 text-sm text-red-400">{errorMessage(notebook.error)}</p>
  const n = notebook.data
  const icon = 'grid size-6 place-items-center rounded text-muted hover:bg-surface-2 hover:text-text disabled:opacity-30'

  return (
    <div className="grid h-full grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-r border-border bg-surface">
        <div className="border-b border-border p-4">
          <Link to="/notebooks" className="mb-2 inline-flex items-center gap-1.5 text-xs text-muted hover:text-text">
            <ArrowLeft size={14} /> Cadernos
          </Link>
          <div className="flex items-start gap-1">
            <h1 className="line-clamp-2 flex-1 font-semibold">{n.title}</h1>
            <Menu
              label="Ações do caderno"
              trigger={<MoreVertical size={16} />}
              items={[
                { label: 'Renomear', icon: <Pencil size={14} />, onSelect: () => setRenaming(true) },
                { label: 'Excluir caderno', icon: <Trash2 size={14} />, onSelect: () => setDeleting(true), danger: true }
              ]}
            />
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Páginas">
          {pages.map((p, i) => (
            <li key={p.id} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setSelected(p.id)
                  if (mode === 'read') document.getElementById(`page-${p.id}`)?.scrollIntoView({ behavior: 'smooth' })
                }}
                aria-current={p.id === currentId ? 'page' : undefined}
                className={`min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm ${p.id === currentId ? 'bg-accent-soft text-accent' : 'hover:bg-surface-2'}`}
              >
                {p.title || 'Sem título'}
              </button>
              <span className="flex opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                <button type="button" onClick={() => movePage.mutate({ id: p.id, index: i - 1 })} disabled={i === 0} aria-label={`Subir ${p.title}`} className={icon}>
                  <ArrowUp size={12} />
                </button>
                <button type="button" onClick={() => movePage.mutate({ id: p.id, index: i + 1 })} disabled={i === pages.length - 1} aria-label={`Descer ${p.title}`} className={icon}>
                  <ArrowDown size={12} />
                </button>
                <button type="button" onClick={() => deletePage.mutate(p.id)} disabled={pages.length <= 1} aria-label={`Excluir ${p.title}`} className={`${icon} hover:text-red-400`}>
                  <Trash2 size={12} />
                </button>
              </span>
            </li>
          ))}
        </ul>
        <div className="border-t border-border p-2">
          <button type="button" onClick={() => addPage.mutate()} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-text">
            <Plus size={14} /> Nova página
          </button>
        </div>
      </aside>

      <main className="min-w-0 overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-end gap-2 border-b border-border bg-bg/90 px-8 py-2 backdrop-blur">
          <div role="tablist" aria-label="Modo" className="mr-auto inline-flex rounded-lg border border-border p-0.5">
            {(
              [
                ['edit', 'Editar', Pencil],
                ['read', 'Ler', BookOpenText]
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => setMode(value)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm ${mode === value ? 'bg-accent-soft text-accent' : 'text-muted hover:text-text'}`}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
          <Button variant="ghost" className="h-8" onClick={() => exportPdf.mutate()} disabled={exportPdf.isPending}>
            {exportPdf.isPending ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} Exportar PDF
          </Button>
        </div>
        <div className="mx-auto max-w-3xl px-14 py-8">
          {mode === 'edit' && currentId !== null ? <PageEditor key={currentId} pageId={currentId} notebookId={notebookId} /> : <NotebookReader notebookId={notebookId} />}
        </div>
      </main>

      <NameDialog
        open={renaming}
        title="Renomear caderno"
        label="Nome"
        initial={n.title}
        submitLabel="Salvar"
        onClose={() => setRenaming(false)}
        onSubmit={async (t) => {
          await window.api.notebooks.rename(notebookId, t)
          await refresh()
        }}
      />
      <ConfirmDialog open={deleting} title="Excluir caderno" confirmLabel="Excluir" busy={deleteNotebook.isPending} onClose={() => setDeleting(false)} onConfirm={() => deleteNotebook.mutate()}>
        <p>
          Excluir <strong className="text-text">“{n.title}”</strong> e todas as suas páginas?
        </p>
      </ConfirmDialog>
    </div>
  )
}
