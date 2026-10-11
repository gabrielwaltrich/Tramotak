import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Check, CloudOff, Link2, Loader2, PenLine, Trash2, Type } from 'lucide-react'
import type { Block, ResourceRef } from '@shared/notebooks'
import { errorMessage } from '../../lib/api'
import { TextBlock } from './TextBlock'
import { InkBlock } from './InkBlock'
import { ResourceBlock, ResourcePicker } from './ResourceBlock'

const SAVE_DELAY_MS = 800
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

let counter = 0
const blockId = () => `b${Date.now().toString(36)}${(counter++).toString(36)}`

function SaveIndicator({ status, error }: { status: SaveStatus; error: string | null }) {
  if (status === 'saving')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted">
        <Loader2 size={12} className="animate-spin" /> Salvando…
      </span>
    )
  if (status === 'saved')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted">
        <Check size={12} /> Salvo
      </span>
    )
  if (status === 'error')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-red-400" title={error ?? undefined}>
        <CloudOff size={12} /> Não foi possível salvar
      </span>
    )
  return null
}

/** Edição de uma página: blocos de texto, desenho e recurso, com salvamento automático. */
export function PageEditor({ pageId, notebookId }: { pageId: number; notebookId: number }) {
  const queryClient = useQueryClient()
  const page = useQuery({ queryKey: ['page', pageId], queryFn: () => window.api.pages.get(pageId), staleTime: 0, gcTime: 0 })
  const [draft, setDraft] = useState<{ title: string; blocks: Block[] } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [picker, setPicker] = useState(false)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pending = useRef<{ title: string; blocks: Block[] } | null>(null)

  const doc = draft ?? (page.data ? { title: page.data.title, blocks: page.data.blocks } : null)

  const persist = async () => {
    const value = pending.current
    if (!value) return
    pending.current = null
    setStatus('saving')
    try {
      await window.api.pages.save(pageId, value)
      setStatus(pending.current ? 'saving' : 'saved')
      void queryClient.invalidateQueries({ queryKey: ['notebook', notebookId] })
    } catch (e) {
      setStatus('error')
      setError(errorMessage(e))
    }
  }
  const persistRef = useRef(persist)
  useEffect(() => {
    persistRef.current = persist
  })

  // Ao trocar de página ou sair, grava o que estiver pendente.
  useEffect(
    () => () => {
      clearTimeout(timer.current)
      void persistRef.current()
    },
    []
  )

  const update = (next: { title: string; blocks: Block[] }) => {
    setDraft(next)
    pending.current = next
    setStatus('saving')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void persistRef.current(), SAVE_DELAY_MS)
  }

  if (page.isPending || !doc) return <Loader2 className="mx-auto my-16 animate-spin text-muted" />
  if (page.isError) return <p className="text-sm text-red-400">{errorMessage(page.error)}</p>

  const setBlock = (id: string, patch: Partial<Block>) =>
    update({ ...doc, blocks: doc.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)) })
  const move = (index: number, delta: number) => {
    const blocks = [...doc.blocks]
    const [b] = blocks.splice(index, 1)
    blocks.splice(index + delta, 0, b)
    update({ ...doc, blocks })
  }
  const remove = (id: string) => update({ ...doc, blocks: doc.blocks.filter((b) => b.id !== id) })
  const add = (block: Block) => {
    update({ ...doc, blocks: [...doc.blocks, block] })
    if (block.type === 'text') setEditing(block.id)
  }

  const adder = 'inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-muted hover:border-accent/50 hover:text-text'
  const control = 'grid size-7 place-items-center rounded text-muted hover:bg-surface-2 hover:text-text disabled:opacity-30'

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <input
          value={doc.title}
          onChange={(e) => update({ ...doc, title: e.target.value })}
          placeholder="Título da página"
          aria-label="Título da página"
          className="min-w-0 flex-1 bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-muted select-text focus-visible:outline-none"
        />
        <SaveIndicator status={status} error={error} />
      </div>

      <div className="space-y-3">
        {doc.blocks.map((b, i) => (
          <div key={b.id} className="group relative">
            <div className="absolute top-1 -left-10 flex flex-col opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Mover bloco para cima" className={control}>
                <ArrowUp size={14} />
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === doc.blocks.length - 1} aria-label="Mover bloco para baixo" className={control}>
                <ArrowDown size={14} />
              </button>
              <button type="button" onClick={() => remove(b.id)} aria-label="Excluir bloco" className={`${control} hover:text-red-400`}>
                <Trash2 size={14} />
              </button>
            </div>
            {b.type === 'text' && (
              <TextBlock
                text={b.text}
                editing={editing === b.id}
                onEdit={() => setEditing(b.id)}
                onChange={(text) => setBlock(b.id, { text })}
                onDone={() => setEditing(null)}
                readOnly={false}
              />
            )}
            {b.type === 'ink' && <InkBlock strokes={b.strokes} height={b.height} onChange={(v) => setBlock(b.id, v)} readOnly={false} />}
            {b.type === 'resource' && <ResourceBlock resource={b.resource} />}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-dashed border-border pt-4">
        <span className="self-center text-xs text-muted">Adicionar:</span>
        <button type="button" onClick={() => add({ id: blockId(), type: 'text', text: '' })} className={adder}>
          <Type size={14} /> Texto
        </button>
        <button type="button" onClick={() => add({ id: blockId(), type: 'ink', strokes: [], height: 300 })} className={adder}>
          <PenLine size={14} /> Desenho
        </button>
        <button type="button" onClick={() => setPicker(true)} className={adder}>
          <Link2 size={14} /> Recurso
        </button>
      </div>

      <ResourcePicker open={picker} onClose={() => setPicker(false)} onPick={(resource: ResourceRef) => add({ id: blockId(), type: 'resource', resource })} />
    </div>
  )
}
