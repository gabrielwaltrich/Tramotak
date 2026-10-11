import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, ClipboardList, ExternalLink, Layers, PlayCircle } from 'lucide-react'
import type { ResourceRef } from '@shared/notebooks'
import { HL_END, HL_START } from '@shared/course'
import { matches } from '@shared/search'
import { Modal } from '../Modal'
import { TextInput } from '../Field'

const LABEL: Record<ResourceRef['kind'], string> = { course: 'Curso', lesson: 'Aula', deck: 'Baralho', bank: 'Banco de questões' }

export function resourceRoute(r: ResourceRef): string {
  return r.kind === 'course' ? `/courses/${r.id}` : r.kind === 'lesson' ? `/lesson/${r.id}` : r.kind === 'deck' ? `/flashcards/${r.id}` : `/questions/${r.id}`
}

export function ResourceIcon({ kind, size = 18 }: { kind: ResourceRef['kind']; size?: number }) {
  const Icon = kind === 'course' ? BookOpen : kind === 'lesson' ? PlayCircle : kind === 'deck' ? Layers : ClipboardList
  return <Icon size={size} />
}

export function ResourceBlock({ resource }: { resource: ResourceRef }) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={() => navigate(resourceRoute(resource))}
      className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left hover:border-accent/50"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
        <ResourceIcon kind={resource.kind} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted">{LABEL[resource.kind]}</span>
        <span className="block truncate text-sm font-medium">{resource.title}</span>
      </span>
      <ExternalLink size={16} className="shrink-0 text-muted" />
    </button>
  )
}

const clean = (s: string) => s.replaceAll(HL_START, '').replaceAll(HL_END, '')

export function ResourcePicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (r: ResourceRef) => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Inserir recurso" wide>
      {open && <PickerBody onPick={(r) => (onPick(r), onClose())} />}
    </Modal>
  )
}

function PickerBody({ onPick }: { onPick: (r: ResourceRef) => void }) {
  const [text, setText] = useState('')
  const courses = useQuery({ queryKey: ['courses'], queryFn: () => window.api.courses.list() })
  const decks = useQuery({ queryKey: ['decks'], queryFn: () => window.api.decks.list() })
  const banks = useQuery({ queryKey: ['banks'], queryFn: () => window.api.banks.list() })
  const lessons = useQuery({
    queryKey: ['search', text.trim()],
    queryFn: () => window.api.search.query(text.trim()),
    enabled: text.trim().length >= 2
  })

  const items: ResourceRef[] = [
    ...(courses.data ?? []).filter((c) => matches(text, c.title)).map((c) => ({ kind: 'course' as const, id: c.id, title: c.title })),
    ...(lessons.data ?? []).filter((h) => h.kind === 'lesson').map((h) => ({ kind: 'lesson' as const, id: h.id, title: `${clean(h.title)} · ${h.courseTitle}` })),
    ...(decks.data ?? []).filter((d) => matches(text, d.title)).map((d) => ({ kind: 'deck' as const, id: d.id, title: d.title })),
    ...(banks.data ?? []).filter((b) => matches(text, b.title)).map((b) => ({ kind: 'bank' as const, id: b.id, title: b.title }))
  ]

  return (
    <div className="space-y-3">
      <TextInput value={text} onChange={(e) => setText(e.target.value)} placeholder="Buscar curso, aula, baralho ou banco…" aria-label="Buscar recurso" data-autofocus />
      {text.trim().length < 2 && <p className="text-xs text-muted">Digite para buscar aulas; cursos, baralhos e bancos aparecem abaixo.</p>}
      <ul className="max-h-80 overflow-y-auto">
        {items.map((r) => (
          <li key={`${r.kind}-${r.id}`}>
            <button type="button" onClick={() => onPick(r)} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-surface-2">
              <span className="text-muted">
                <ResourceIcon kind={r.kind} size={16} />
              </span>
              <span className="min-w-0 flex-1 truncate">{r.title}</span>
              <span className="text-xs text-muted">{LABEL[r.kind]}</span>
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="py-6 text-center text-sm text-muted">Nada encontrado.</li>}
      </ul>
    </div>
  )
}
