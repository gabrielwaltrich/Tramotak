import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Clock, Loader2, Pencil, Plus, StickyNote, Trash2 } from 'lucide-react'
import type { Note } from '@shared/course'
import { formatClock } from '@shared/format'
import { errorMessage, queryKeys } from '../../lib/api'
import { Button } from '../Button'
import { TextArea } from '../Field'
import { useToast } from '../Toast'

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

const isSubmit = (e: React.KeyboardEvent) => e.key === 'Enter' && (e.ctrlKey || e.metaKey)

function TimeChip({ seconds, onClick }: { seconds: number; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={onClick ? 'Ir para este ponto do vídeo' : undefined}
      className="inline-flex h-6 shrink-0 items-center gap-1 rounded bg-accent-soft px-1.5 text-xs font-medium text-accent tabular-nums hover:brightness-125 disabled:cursor-default"
    >
      <Clock size={12} /> {formatClock(seconds)}
    </button>
  )
}

function NoteItem({ note, onSeek, lessonId }: { note: Note; onSeek?: (sec: number) => void; lessonId: number }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.body)
  const [confirming, setConfirming] = useState(false)
  const queryClient = useQueryClient()
  const toast = useToast()
  const key = queryKeys.notes(lessonId)

  const update = useMutation({
    mutationFn: () => window.api.notes.update(note.id, draft),
    onSuccess: (saved) => {
      queryClient.setQueryData<Note[]>(key, (list) => list?.map((n) => (n.id === saved.id ? saved : n)))
      setEditing(false)
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  const remove = useMutation({
    mutationFn: () => window.api.notes.delete(note.id),
    onSuccess: () => queryClient.setQueryData<Note[]>(key, (list) => list?.filter((n) => n.id !== note.id)),
    onError: (error) => toast(errorMessage(error), 'error')
  })

  return (
    <li className="group flex gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-2">
      {note.timestampSec !== null ? (
        <TimeChip seconds={note.timestampSec} onClick={onSeek ? () => onSeek(note.timestampSec!) : undefined} />
      ) : (
        <StickyNote size={16} className="mt-1 shrink-0 text-muted" />
      )}

      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="space-y-2">
            <TextArea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (isSubmit(e)) update.mutate()
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setEditing(false)
                  setDraft(note.body)
                }
              }}
              autoFocus
              aria-label="Editar anotação"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => (setEditing(false), setDraft(note.body))}>
                Cancelar
              </Button>
              <Button onClick={() => update.mutate()} disabled={!draft.trim() || update.isPending}>
                Salvar
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm break-words whitespace-pre-wrap select-text">{note.body}</p>
            {note.updatedAt > note.createdAt && <p className="mt-0.5 text-xs text-muted">editada</p>}
          </>
        )}
      </div>

      {!editing &&
        (confirming ? (
          <div className="flex shrink-0 items-center gap-1 text-xs">
            <span className="text-muted">Excluir?</span>
            <button type="button" onClick={() => remove.mutate()} className="rounded px-1.5 py-0.5 text-red-400 hover:bg-red-500/10">
              Sim
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded px-1.5 py-0.5 text-muted hover:bg-surface">
              Não
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 gap-0.5 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
            <button type="button" onClick={() => setEditing(true)} aria-label="Editar anotação" className="grid size-7 place-items-center rounded text-muted hover:bg-surface hover:text-text">
              <Pencil size={14} />
            </button>
            <button type="button" onClick={() => setConfirming(true)} aria-label="Excluir anotação" className="grid size-7 place-items-center rounded text-muted hover:bg-surface hover:text-red-400">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
    </li>
  )
}

/**
 * Anotações da aula. `N` (fora de campos de texto) abre o editor já com o horário atual do vídeo;
 * Ctrl/Cmd+Enter salva, Esc cancela.
 */
export function NotesPanel({ lessonId, notes, loading, getTime, onSeek }: {
  lessonId: number
  notes: Note[]
  loading: boolean
  /** Horário atual do vídeo; `null` quando a aula não é vídeo. */
  getTime: () => number | null
  onSeek?: (sec: number) => void
}) {
  const [composing, setComposing] = useState<{ timestampSec: number | null } | null>(null)
  const [draft, setDraft] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const queryClient = useQueryClient()
  const toast = useToast()

  const start = () => {
    setComposing({ timestampSec: getTime() })
    requestAnimationFrame(() => textareaRef.current?.focus())
  }
  const startRef = useRef(start)
  useEffect(() => {
    startRef.current = start
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'n' || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return
      e.preventDefault() // sem isso o "n" seria digitado no campo recém-focado
      startRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const cancel = () => {
    setComposing(null)
    setDraft('')
  }

  const create = useMutation({
    mutationFn: () => window.api.notes.create({ lessonId, timestampSec: composing?.timestampSec ?? null, body: draft }),
    onSuccess: (note) => {
      queryClient.setQueryData<Note[]>(queryKeys.notes(lessonId), (list) =>
        [...(list ?? []), note].sort(
          (a, b) =>
            Number(a.timestampSec === null) - Number(b.timestampSec === null) ||
            (a.timestampSec ?? 0) - (b.timestampSec ?? 0) ||
            a.id - b.id
        )
      )
      cancel()
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  // Re-renderiza a cada segundo para o botão mostrar o horário atual do vídeo.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (getTime() === null) return
    const timer = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(timer)
  }, [getTime])
  const currentTime = getTime()

  return (
    <div>
      {composing ? (
        <div className="mb-3 space-y-2 rounded-lg border border-accent/40 bg-bg p-3">
          <div className="flex items-center gap-2 text-xs text-muted">
            {composing.timestampSec !== null ? (
              <>
                Anotação em <TimeChip seconds={composing.timestampSec} />
              </>
            ) : (
              'Nova anotação'
            )}
          </div>
          <TextArea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (isSubmit(e) && draft.trim()) create.mutate()
              if (e.key === 'Escape') {
                e.stopPropagation()
                cancel()
              }
            }}
            placeholder="Escreva sua anotação…"
            aria-label="Nova anotação"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">Ctrl+Enter salva · Esc cancela</span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={cancel}>
                Cancelar
              </Button>
              <Button onClick={() => create.mutate()} disabled={!draft.trim() || create.isPending}>
                {create.isPending && <Loader2 size={14} className="animate-spin" />} Salvar
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={start}
          className="mb-3 flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted hover:border-accent/60 hover:text-text"
        >
          <Plus size={16} />
          {currentTime !== null ? `Anotar em ${formatClock(currentTime)}` : 'Nova anotação'}
          <kbd className="ml-auto rounded border border-border px-1.5 text-xs">N</kbd>
        </button>
      )}

      {loading ? (
        <div className="grid place-items-center py-6 text-muted">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : notes.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">Nenhuma anotação nesta aula ainda.</p>
      ) : (
        <ul className="divide-y divide-border">
          {notes.map((n) => (
            <NoteItem key={n.id} note={n} onSeek={onSeek} lessonId={lessonId} />
          ))}
        </ul>
      )}
    </div>
  )
}
