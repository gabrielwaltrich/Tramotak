import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { BookOpen, Clock, CornerDownLeft, FileText, FolderTree, Loader2, PlayCircle, Search, StickyNote, X } from 'lucide-react'
import type { SearchHit, SearchKind } from '@shared/course'
import { formatClock } from '@shared/format'
import { errorMessage, queryKeys } from '../lib/api'
import { readPref, writePref } from '../storage'
import { Highlight } from './Highlight'

const DEBOUNCE_MS = 150
const RECENT_KEY = 'tramotak.search.recent'
const MAX_RECENT = 6

const GROUPS: { kind: SearchKind; label: string }[] = [
  { kind: 'course', label: 'Cursos' },
  { kind: 'module', label: 'Módulos' },
  { kind: 'lesson', label: 'Aulas' },
  { kind: 'note', label: 'Anotações' }
]

function readRecent(): string[] {
  try {
    const list = JSON.parse(readPref(RECENT_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((s) => typeof s === 'string').slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}

function rememberSearch(text: string) {
  const value = text.trim()
  if (value.length < 2) return
  writePref(RECENT_KEY, JSON.stringify([value, ...readRecent().filter((s) => s !== value)].slice(0, MAX_RECENT)))
}

/** Rota de destino de cada resultado. Anotações abrem a aula já no horário da nota. */
export function hitRoute(hit: SearchHit): string {
  switch (hit.kind) {
    case 'course':
      return `/courses/${hit.id}`
    case 'module':
      return `/courses/${hit.courseId}`
    case 'lesson':
      return `/lesson/${hit.id}`
    case 'note':
      return hit.timestampSec !== null ? `/lesson/${hit.lessonId}?t=${Math.floor(hit.timestampSec)}` : `/lesson/${hit.lessonId}`
  }
}

function HitIcon({ hit }: { hit: SearchHit }) {
  const cls = 'shrink-0 text-muted'
  if (hit.kind === 'course') return <BookOpen size={16} className={cls} />
  if (hit.kind === 'module') return <FolderTree size={16} className={cls} />
  if (hit.kind === 'note') return <StickyNote size={16} className={cls} />
  return hit.lessonKind === 'video' ? <PlayCircle size={16} className={cls} /> : <FileText size={16} className={cls} />
}

function context(hit: SearchHit): string {
  if (hit.kind === 'course') return 'Curso'
  return [hit.courseTitle, hit.moduleTitle].filter(Boolean).join(' · ')
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label="Buscar"
      className="mx-auto mt-[12vh] w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-surface p-0 text-text shadow-2xl backdrop:bg-black/50"
    >
      {open && <PaletteBody onClose={onClose} />}
    </dialog>
  )
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const [recent, setRecent] = useState(readRecent)
  const query = useDebounced(text.trim(), DEBOUNCE_MS)
  const searching = query.length >= 2

  const results = useQuery({
    queryKey: queryKeys.search(query),
    queryFn: () => window.api.search.query(query),
    enabled: searching,
    staleTime: 0,
    placeholderData: keepPreviousData
  })

  // Lista achatada na mesma ordem em que os grupos aparecem, para navegar com as setas.
  const groups = useMemo(() => {
    const hits = searching ? (results.data ?? []) : []
    return GROUPS.map((g) => ({ ...g, hits: hits.filter((h) => h.kind === g.kind) })).filter((g) => g.hits.length > 0)
  }, [results.data, searching])
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups])
  const current = Math.min(active, Math.max(flat.length - 1, 0))

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [current])

  const openHit = (hit: SearchHit) => {
    rememberSearch(text)
    onClose()
    navigate(hitRoute(hit))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && flat[current]) {
      e.preventDefault()
      openHit(flat[current])
    }
  }

  let index = -1

  return (
    <div onKeyDown={onKeyDown}>
      <div className="flex items-center gap-3 border-b border-border px-4">
        <Search size={18} className="shrink-0 text-muted" />
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setActive(0)
          }}
          placeholder="Buscar cursos, aulas e anotações…"
          aria-label="Buscar"
          role="combobox"
          aria-expanded={flat.length > 0}
          aria-controls="search-results"
          aria-activedescendant={flat[current] ? `hit-${current}` : undefined}
          className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-muted select-text focus-visible:outline-none"
        />
        {results.isFetching && <Loader2 size={16} className="animate-spin text-muted" />}
        {text && (
          <button type="button" onClick={() => (setText(''), inputRef.current?.focus())} aria-label="Limpar" className="text-muted hover:text-text">
            <X size={16} />
          </button>
        )}
      </div>

      <div ref={listRef} id="search-results" role="listbox" aria-label="Resultados" className="max-h-[55vh] overflow-y-auto p-2">
        {!searching ? (
          recent.length > 0 ? (
            <div className="p-2">
              <div className="mb-2 flex items-center justify-between text-xs text-muted">
                <span>Buscas recentes</span>
                <button
                  type="button"
                  onClick={() => {
                    writePref(RECENT_KEY, '[]')
                    setRecent([])
                  }}
                  className="hover:text-text"
                >
                  Limpar
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {recent.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => (setText(r), inputRef.current?.focus())}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-sm text-muted hover:text-text"
                  >
                    <Clock size={12} /> {r}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="px-3 py-8 text-center text-sm text-muted">Digite pelo menos 2 letras. Acentos e maiúsculas não importam.</p>
          )
        ) : results.isError ? (
          <p className="px-3 py-6 text-sm text-red-400">{errorMessage(results.error)}</p>
        ) : flat.length === 0 && !results.isFetching ? (
          <p className="px-3 py-8 text-center text-sm text-muted">Nada encontrado para “{query}”.</p>
        ) : (
          groups.map((g) => (
            <div key={g.kind} role="group" aria-label={g.label} className="mb-1">
              <p className="px-3 pt-2 pb-1 text-xs font-medium tracking-wider text-muted uppercase">{g.label}</p>
              {g.hits.map((hit) => {
                index++
                const i = index
                return (
                  <div
                    key={`${hit.kind}-${hit.id}`}
                    id={`hit-${i}`}
                    role="option"
                    aria-selected={i === current}
                    onMouseMove={() => setActive(i)}
                    onClick={() => openHit(hit)}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 ${i === current ? 'bg-accent-soft' : ''}`}
                  >
                    <div className="mt-0.5">
                      <HitIcon hit={hit} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        {hit.kind === 'note' ? hit.title : <Highlight text={hit.title} />}
                      </p>
                      {hit.snippet && (
                        <p className="mt-0.5 line-clamp-2 text-sm text-muted">
                          <Highlight text={hit.snippet} />
                        </p>
                      )}
                      <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
                        {hit.kind === 'note' && hit.timestampSec !== null && (
                          <span className="rounded bg-surface-2 px-1 tabular-nums">{formatClock(hit.timestampSec)}</span>
                        )}
                        {context(hit)}
                      </p>
                    </div>
                    {i === current && <CornerDownLeft size={14} className="mt-1 shrink-0 text-muted" />}
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>

      <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-xs text-muted">
        <span>
          <kbd className="rounded border border-border px-1">↑</kbd> <kbd className="rounded border border-border px-1">↓</kbd> navegar
        </span>
        <span>
          <kbd className="rounded border border-border px-1">Enter</kbd> abrir
        </span>
        <span>
          <kbd className="rounded border border-border px-1">Esc</kbd> fechar
        </span>
      </div>
    </div>
  )
}
