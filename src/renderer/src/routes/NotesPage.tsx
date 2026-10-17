import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Clock, Download, Layers, Loader2, NotebookPen, Pencil, PlayCircle, Search, StickyNote, Trash2, X } from 'lucide-react'
import { formatClock, plural } from '@shared/format'
import { groupByLesson, noteLink, notesToMarkdown, noteWhere, suggestedPageTitle, type NoteEntry } from '@shared/notes'
import { matches } from '@shared/search'
import { errorMessage, queryKeys } from '../lib/api'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { Button } from '../components/Button'
import { Segmented, TextArea, TextInput } from '../components/Field'
import { RichText } from '../components/RichText'
import { useToast } from '../components/Toast'
import { SendToNotebookDialog } from '../components/notes/SendToNotebookDialog'
import { CardFromNoteDialog } from '../components/flashcards/CardFromNoteDialog'

type Sort = 'course' | 'recent'

const lessonUrl = (n: Pick<NoteEntry, 'lessonId' | 'timestampSec' | 'page' | 'assetPath'>) => noteLink(n.lessonId, n.timestampSec, n.page, n.assetPath).slice(1)

/** Todas as anotações dos cursos num lugar só: busca, filtro por curso, edição e envio para os cadernos. */
export function NotesPage() {
  const [params, setParams] = useSearchParams()
  const courseFilter = Number(params.get('course')) || null
  const [text, setText] = useState('')
  const [sort, setSort] = useState<Sort>('course')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [sending, setSending] = useState<NoteEntry[] | null>(null)
  const [cardNote, setCardNote] = useState<NoteEntry | null>(null)
  const toast = useToast()

  const notes = useQuery({ queryKey: ['notes', 'all'], queryFn: () => window.api.notes.all(), staleTime: 0 })
  const all = useMemo(() => notes.data ?? [], [notes.data])
  const courses = useMemo(() => {
    const map = new Map<number, string>()
    for (const n of all) map.set(n.courseId, n.courseTitle)
    return [...map].map(([id, title]) => ({ id, title }))
  }, [all])

  const visible = useMemo(() => {
    const filtered = all.filter(
      (n) => (courseFilter === null || n.courseId === courseFilter) && matches(text, n.body, n.lessonTitle, n.modulePath.join(' '))
    )
    return sort === 'recent' ? [...filtered].sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id) : filtered
  }, [all, courseFilter, text, sort])

  const chosen = visible.filter((n) => selected.has(n.id))
  const target = chosen.length > 0 ? chosen : visible
  const lessonCount = new Set(visible.map((n) => n.lessonId)).size

  const toggle = (ids: number[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })

  const exportMd = useMutation({
    mutationFn: (entries: NoteEntry[]) => window.api.notes.exportMarkdown(notesToMarkdown(entries), suggestedPageTitle(entries)),
    onSuccess: (path) => path && toast('Anotações exportadas'),
    onError: (error) => toast(errorMessage(error), 'error')
  })

  const scope = chosen.length > 0 ? plural(chosen.length, 'selecionada', 'selecionadas') : 'todas as visíveis'

  return (
    <div className="mx-auto max-w-4xl p-8">
      <PageHeader
        title="Anotações"
        subtitle="Tudo o que você anotou nas aulas, num lugar só"
        actions={
          all.length > 0 && (
            <>
              <Button variant="ghost" onClick={() => exportMd.mutate(target)} disabled={target.length === 0} title={`Exportar ${scope} em Markdown`}>
                <Download size={16} /> Exportar
              </Button>
              <Button onClick={() => setSending(target)} disabled={target.length === 0} title={`Enviar ${scope} para um caderno`}>
                <NotebookPen size={16} /> Enviar para caderno
              </Button>
            </>
          )
        }
      />

      {notes.isPending ? (
        <div className="grid place-items-center py-20 text-muted">
          <Loader2 className="animate-spin" />
        </div>
      ) : all.length === 0 ? (
        <EmptyState
          icon={<StickyNote size={22} />}
          title="Nenhuma anotação ainda"
          description="No player, aperte N para anotar no ponto do vídeo. Todas as anotações aparecem aqui, separadas por curso e aula."
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative min-w-56 flex-1">
              <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
              <TextInput value={text} onChange={(e) => setText(e.target.value)} placeholder="Buscar nas anotações…" aria-label="Buscar nas anotações" className="pl-9" />
            </div>
            <select
              aria-label="Curso"
              value={courseFilter ?? ''}
              onChange={(e) => {
                setSelected(new Set())
                setParams(e.target.value ? { course: e.target.value } : {})
              }}
              className="h-9 max-w-64 rounded-md border border-border bg-bg px-3 text-sm"
            >
              <option value="">Todos os cursos</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <Segmented
              label="Ordem"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'course', label: 'Ordem do curso' },
                { value: 'recent', label: 'Mais recentes' }
              ]}
            />
          </div>

          <div className="mb-3 flex min-h-8 flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2 text-muted">
              <input
                type="checkbox"
                checked={visible.length > 0 && chosen.length === visible.length}
                ref={(el) => {
                  if (el) el.indeterminate = chosen.length > 0 && chosen.length < visible.length
                }}
                onChange={(e) => toggle(visible.map((n) => n.id), e.target.checked)}
                aria-label="Selecionar todas as visíveis"
                className="size-4 accent-[var(--accent)]"
              />
              {plural(visible.length, 'anotação', 'anotações')} em {plural(lessonCount, 'aula')}
            </label>
            {chosen.length > 0 && (
              <span className="flex items-center gap-2 text-accent">
                · {plural(chosen.length, 'selecionada', 'selecionadas')}
                <button type="button" onClick={() => setSelected(new Set())} className="inline-flex items-center gap-1 text-xs text-muted hover:text-text">
                  <X size={12} /> limpar
                </button>
              </span>
            )}
          </div>

          {visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">Nenhuma anotação encontrada.</p>
          ) : sort === 'course' ? (
            <CourseOrder entries={visible} selected={selected} onToggle={toggle} onMakeCard={setCardNote} showCourse={courseFilter === null && courses.length > 1} />
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
              {visible.map((n) => (
                <NoteRow key={n.id} note={n} checked={selected.has(n.id)} onToggle={toggle} onMakeCard={setCardNote} context />
              ))}
            </ul>
          )}
        </>
      )}

      {sending && <SendToNotebookDialog entries={sending} onClose={() => setSending(null)} />}
      <CardFromNoteDialog
        note={cardNote}
        lessonId={cardNote?.lessonId ?? 0}
        course={{ id: cardNote?.courseId ?? 0, title: cardNote?.courseTitle ?? '' }}
        onClose={() => setCardNote(null)}
      />
    </div>
  )
}

function CourseOrder({ entries, selected, onToggle, onMakeCard, showCourse }: {
  entries: NoteEntry[]
  selected: Set<number>
  onToggle: (ids: number[], on: boolean) => void
  onMakeCard: (note: NoteEntry) => void
  showCourse: boolean
}) {
  const groups = groupByLesson(entries)
  return (
    <div className="space-y-4">
      {groups.map((g, i) => {
        const header = showCourse && (i === 0 || groups[i - 1].courseId !== g.courseId)
        const ids = g.notes.map((n) => n.id)
        const all = ids.every((id) => selected.has(id))
        return (
          <div key={g.lessonId}>
            {header && <h2 className="mt-6 mb-2 text-sm font-semibold tracking-wide text-muted uppercase first:mt-0">{g.courseTitle}</h2>}
            <section className="rounded-xl border border-border bg-surface" aria-label={g.lessonTitle}>
              <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
                <input
                  type="checkbox"
                  checked={all}
                  onChange={(e) => onToggle(ids, e.target.checked)}
                  aria-label={`Selecionar as anotações de ${g.lessonTitle}`}
                  className="size-4 accent-[var(--accent)]"
                />
                <div className="min-w-0 flex-1">
                  {g.modulePath.length > 0 && <p className="truncate text-xs text-muted">{g.modulePath.join(' › ')}</p>}
                  <Link to={`/lesson/${g.lessonId}`} className="block truncate text-sm font-medium hover:text-accent" title={g.lessonTitle}>
                    {g.lessonTitle}
                  </Link>
                </div>
                <span className="shrink-0 text-xs text-muted">{plural(g.notes.length, 'nota', 'notas')}</span>
              </header>
              <ul className="divide-y divide-border">
                {g.notes.map((n) => (
                  <NoteRow key={n.id} note={n} checked={selected.has(n.id)} onToggle={onToggle} onMakeCard={onMakeCard} />
                ))}
              </ul>
            </section>
          </div>
        )
      })}
    </div>
  )
}

function NoteRow({ note, checked, onToggle, onMakeCard, context = false }: {
  note: NoteEntry
  checked: boolean
  onToggle: (ids: number[], on: boolean) => void
  onMakeCard: (note: NoteEntry) => void
  /** Mostra curso e aula (na ordem "mais recentes", em que as notas não ficam agrupadas). */
  context?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.body)
  const [confirming, setConfirming] = useState(false)
  const queryClient = useQueryClient()
  const toast = useToast()
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.notes(note.lessonId).slice(0, 1) })

  const update = useMutation({
    mutationFn: () => window.api.notes.update(note.id, draft),
    onSuccess: async () => {
      await refresh()
      setEditing(false)
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const remove = useMutation({
    mutationFn: () => window.api.notes.delete(note.id),
    onSuccess: async () => {
      onToggle([note.id], false)
      await refresh()
      toast('Anotação excluída')
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  return (
    <li className="group flex gap-3 px-4 py-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onToggle([note.id], e.target.checked)}
        aria-label="Selecionar anotação"
        className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
      />
      {note.page !== null ? (
        <Link
          to={lessonUrl(note)}
          title="Abrir o PDF nesta página"
          className="inline-flex h-6 max-w-40 shrink-0 items-center gap-1 rounded bg-accent-soft px-1.5 text-xs font-medium text-accent tabular-nums hover:brightness-125"
        >
          <BookOpen size={12} className="shrink-0" /> <span className="truncate">{noteWhere(note)}</span>
        </Link>
      ) : note.timestampSec !== null ? (
        <Link
          to={lessonUrl(note)}
          title="Abrir o vídeo neste ponto"
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded bg-accent-soft px-1.5 text-xs font-medium text-accent tabular-nums hover:brightness-125"
        >
          <Clock size={12} /> {formatClock(note.timestampSec)}
        </Link>
      ) : (
        <Link to={lessonUrl(note)} title="Abrir a aula" className="mt-0.5 shrink-0 text-muted hover:text-accent">
          <PlayCircle size={18} />
        </Link>
      )}
      <div className="min-w-0 flex-1">
        {context && (
          <p className="mb-0.5 truncate text-xs text-muted">
            {note.courseTitle} · {note.lessonTitle}
          </p>
        )}
        {editing ? (
          <div className="space-y-2">
            <TextArea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && draft.trim()) update.mutate()
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
          <RichText text={note.body} className="block text-sm break-words select-text" />
        )}
      </div>
      {!editing &&
        (confirming ? (
          <div className="flex shrink-0 items-center gap-1 self-start text-xs">
            <span className="text-muted">Excluir?</span>
            <button type="button" onClick={() => remove.mutate()} className="rounded px-1.5 py-0.5 text-red-400 hover:bg-red-500/10">
              Sim
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded px-1.5 py-0.5 text-muted hover:bg-surface-2">
              Não
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 gap-0.5 self-start opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
            <button type="button" onClick={() => onMakeCard(note)} aria-label="Criar flashcard" title="Criar flashcard" className="grid size-7 place-items-center rounded text-muted hover:bg-surface-2 hover:text-text">
              <Layers size={14} />
            </button>
            <button type="button" onClick={() => setEditing(true)} aria-label="Editar anotação" title="Editar" className="grid size-7 place-items-center rounded text-muted hover:bg-surface-2 hover:text-text">
              <Pencil size={14} />
            </button>
            <button type="button" onClick={() => setConfirming(true)} aria-label="Excluir anotação" title="Excluir" className="grid size-7 place-items-center rounded text-muted hover:bg-surface-2 hover:text-red-400">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
    </li>
  )
}
