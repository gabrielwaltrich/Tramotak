import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, GitFork, Loader2, Save } from 'lucide-react'
import type { AiResult, AiSource, GeneratedCard } from '@shared/ai'
import { setAttachment, childrenOf, getNode, type MindMapData } from '@shared/mindmap'
import { QUESTION_TYPE_LABEL, type QuestionInput } from '@shared/questions'
import { normalize } from '@shared/search'
import { plural } from '@shared/format'
import { errorMessage, queryKeys } from '../../lib/api'
import { renderMarkdown } from '../../lib/markdown'
import { Button } from '../Button'
import { Label, TextArea, TextInput } from '../Field'
import { RichText } from '../RichText'
import { useToast } from '../Toast'

const SELECT = 'h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-text'
export const NEW = 'new'

/** Destino: um item existente ou um novo com nome. */
export function Destination({ label, id, items, value, onChange, newName, onNewName, newLabel }: {
  label: string
  id: string
  items: { id: number; title: string }[]
  value: string
  onChange: (value: string) => void
  newName: string
  onNewName: (name: string) => void
  newLabel: string
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <select id={id} className={SELECT} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value={NEW}>{newLabel}</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.title}
            </option>
          ))}
        </select>
      </div>
      {value === NEW && (
        <div>
          <Label htmlFor={`${id}-name`}>Nome</Label>
          <TextInput id={`${id}-name`} value={newName} onChange={(e) => onNewName(e.target.value)} />
        </div>
      )}
    </div>
  )
}

function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} className="mt-1 size-4 shrink-0 accent-[var(--accent)]" />
}

function SaveBar({ count, noun, onSave, busy, extra }: { count: number; noun: [string, string]; onSave: () => void; busy: boolean; extra?: string }) {
  return (
    <div className="sticky bottom-0 -mx-5 -mb-5 flex items-center justify-between gap-3 rounded-b-xl border-t border-border bg-surface px-5 py-3">
      <span className="text-sm text-muted">
        {count ? `${plural(count, noun[0], noun[1])} para salvar` : 'Nada selecionado'}
        {extra ? ` · ${extra}` : ''}
      </span>
      <Button onClick={onSave} disabled={!count || busy}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Salvar
      </Button>
    </div>
  )
}

// ── Flashcards ──────────────────────────────────────────────────────────────

function CardsReview({ initial, source, deckId }: { initial: GeneratedCard[]; source: AiSource; deckId: number | null }) {
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [cards, setCards] = useState(initial.map((c) => ({ ...c, keep: true })))
  const decks = useQuery({ queryKey: queryKeys.decks, queryFn: () => window.api.decks.list() })
  const preferred = deckId ?? decks.data?.find((d) => source.courseId !== null && d.courseId === source.courseId)?.id ?? null
  const [choice, setChoice] = useState<string | null>(null)
  const target = choice ?? (preferred !== null ? String(preferred) : NEW)
  const [name, setName] = useState(source.title.replace(/\s*\(.*\)$/, ''))
  const existing = useQuery({ queryKey: queryKeys.deck(Number(target)), queryFn: () => window.api.decks.get(Number(target)), enabled: target !== NEW })
  const fronts = useMemo(() => new Set((existing.data?.cards ?? []).map((c) => normalize(c.front.trim()))), [existing.data])
  const isDup = (front: string) => target !== NEW && fronts.has(normalize(front.trim()))
  const selected = cards.filter((c) => c.keep && c.front.trim() && c.back.trim() && !isDup(c.front))
  const dups = cards.filter((c) => c.keep && isDup(c.front)).length

  const save = useMutation({
    mutationFn: async () => {
      const id = target === NEW ? await window.api.decks.create({ title: name.trim() || 'Gerado pela IA', courseId: source.courseId }) : Number(target)
      for (const c of selected) await window.api.cards.create({ deckId: id, front: c.front.trim(), back: c.back.trim(), lessonId: source.lessonId })
      return id
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.decks })
      toast(`${plural(selected.length, 'carta salva', 'cartas salvas')}`)
      navigate(`/flashcards/${id}`)
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  const update = (i: number, patch: Partial<(typeof cards)[number]>) => setCards((list) => list.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  return (
    <div className="space-y-4">
      <Destination label="Baralho" id="ai-deck" items={decks.data ?? []} value={target} onChange={setChoice} newName={name} onNewName={setName} newLabel="Novo baralho…" />
      <ol className="space-y-2">
        {cards.map((c, i) => (
          <li key={i} className={`flex gap-3 rounded-lg border border-border p-3 ${c.keep ? '' : 'opacity-50'}`}>
            <Checkbox checked={c.keep} onChange={(keep) => update(i, { keep })} label={`Incluir carta ${i + 1}`} />
            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
              <TextArea value={c.front} onChange={(e) => update(i, { front: e.target.value })} aria-label={`Frente da carta ${i + 1}`} className="min-h-16" />
              <TextArea value={c.back} onChange={(e) => update(i, { back: e.target.value })} aria-label={`Verso da carta ${i + 1}`} className="min-h-16" />
            </div>
            {isDup(c.front) && <span className="h-fit shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-[11px] text-warning">já existe</span>}
          </li>
        ))}
      </ol>
      <SaveBar count={selected.length} noun={['carta', 'cartas']} onSave={() => save.mutate()} busy={save.isPending} extra={dups ? `${plural(dups, 'repetida ignorada', 'repetidas ignoradas')}` : undefined} />
    </div>
  )
}

// ── Questões ────────────────────────────────────────────────────────────────

function isCorrect(q: QuestionInput, optionId: string): boolean {
  return (q.key.type === 'single' && q.key.correct === optionId) || (q.key.type === 'multiple' && q.key.correct.includes(optionId))
}

function QuestionsReview({ initial, source, bankId }: { initial: QuestionInput[]; source: AiSource; bankId: number | null }) {
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [items, setItems] = useState(initial.map((q) => ({ q, keep: true })))
  const banks = useQuery({ queryKey: ['banks'], queryFn: () => window.api.banks.list() })
  const [choice, setChoice] = useState<string | null>(null)
  const target = choice ?? (bankId !== null ? String(bankId) : NEW)
  const [name, setName] = useState(source.title.replace(/\s*\(.*\)$/, ''))
  const selected = items.filter((i) => i.keep && i.q.statement.trim())

  const save = useMutation({
    mutationFn: async () => {
      const id = target === NEW ? await window.api.banks.create({ title: name.trim() || 'Gerado pela IA' }) : Number(target)
      for (const { q } of selected) await window.api.questions.create(id, { ...q, statement: q.statement.trim() })
      return id
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ['banks'] })
      toast(`${plural(selected.length, 'questão salva', 'questões salvas')}`)
      navigate(`/questions/${id}`)
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  const update = (i: number, patch: Partial<(typeof items)[number]>) => setItems((list) => list.map((it, j) => (j === i ? { ...it, ...patch } : it)))

  return (
    <div className="space-y-4">
      <Destination label="Banco de questões" id="ai-bank" items={banks.data ?? []} value={target} onChange={setChoice} newName={name} onNewName={setName} newLabel="Novo banco…" />
      <ol className="space-y-2">
        {items.map(({ q, keep }, i) => (
          <li key={i} className={`flex gap-3 rounded-lg border border-border p-3 ${keep ? '' : 'opacity-50'}`}>
            <Checkbox checked={keep} onChange={(v) => update(i, { keep: v })} label={`Incluir questão ${i + 1}`} />
            <div className="min-w-0 flex-1 space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                <span className="rounded bg-surface-2 px-1.5 py-0.5">{QUESTION_TYPE_LABEL[q.type]}</span>
                {q.topic && <span className="rounded bg-surface-2 px-1.5 py-0.5">{q.topic}</span>}
                <span className="rounded bg-surface-2 px-1.5 py-0.5">dificuldade {q.difficulty}</span>
              </div>
              <TextArea value={q.statement} onChange={(e) => update(i, { q: { ...q, statement: e.target.value } })} aria-label={`Enunciado da questão ${i + 1}`} className="min-h-14" />
              {q.statement.includes('$') && (
                <p className="rounded bg-bg/50 px-2 py-1">
                  <RichText text={q.statement} />
                </p>
              )}
              {q.options.length > 0 && (
                <ul className="space-y-1">
                  {q.options.map((o, k) => (
                    <li key={o.id} className={`flex gap-2 rounded px-2 py-1 ${isCorrect(q, o.id) ? 'bg-success/10 text-success' : ''}`}>
                      <span className="w-4 shrink-0 font-medium">{String.fromCharCode(65 + k)}</span>
                      <RichText text={o.text} />
                      {isCorrect(q, o.id) && <Check size={14} className="ml-auto shrink-0" aria-label="correta" />}
                    </li>
                  ))}
                </ul>
              )}
              {q.key.type === 'truefalse' && <p className="text-success">Gabarito: {q.key.correct ? 'Verdadeiro' : 'Falso'}</p>}
              {q.key.type === 'short' && <p className="text-success">Aceita: {q.key.accepted.join(' · ')}</p>}
              {q.explanation && (
                <p className="text-xs text-muted">
                  <RichText text={q.explanation} />
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      <SaveBar count={selected.length} noun={['questão', 'questões']} onSave={() => save.mutate()} busy={save.isPending} />
    </div>
  )
}

// ── Resumo ──────────────────────────────────────────────────────────────────

function SummaryReview({ initial, source }: { initial: { title: string; markdown: string }; source: AiSource }) {
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(initial.title)
  const [markdown, setMarkdown] = useState(initial.markdown)
  const [editing, setEditing] = useState(false)
  const notebooks = useQuery({ queryKey: ['notebooks'], queryFn: () => window.api.notebooks.list() })
  const [target, setTarget] = useState(NEW)
  const [name, setName] = useState('Resumos')
  const html = useMemo(() => renderMarkdown(markdown), [markdown])

  const save = useMutation({
    mutationFn: async () => {
      const id = target === NEW ? await window.api.notebooks.create(name.trim() || 'Resumos') : Number(target)
      const page = await window.api.pages.create(id)
      const blocks = [
        ...(source.lessonId !== null ? [{ id: 'ai-src', type: 'resource', resource: { kind: 'lesson', id: source.lessonId, title: source.title } }] : []),
        { id: 'ai-text', type: 'text', text: markdown }
      ]
      await window.api.pages.save(page.id, { title: title.trim() || 'Resumo', blocks })
      return { id, pageId: page.id }
    },
    onSuccess: async ({ id, pageId }) => {
      await queryClient.invalidateQueries({ queryKey: ['notebooks'] })
      toast('Resumo salvo no caderno')
      navigate(`/notebooks/${id}?page=${pageId}`)
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  return (
    <div className="space-y-4">
      <Destination label="Caderno" id="ai-notebook-dest" items={notebooks.data ?? []} value={target} onChange={setTarget} newName={name} onNewName={setName} newLabel="Novo caderno…" />
      <div>
        <Label htmlFor="ai-summary-title">Título da página</Label>
        <TextInput id="ai-summary-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={() => setEditing((v) => !v)} className="text-xs text-accent hover:underline">
          {editing ? 'Ver resultado' : 'Editar Markdown'}
        </button>
      </div>
      {editing ? (
        <TextArea value={markdown} onChange={(e) => setMarkdown(e.target.value)} aria-label="Resumo em Markdown" className="min-h-96 font-mono text-xs" />
      ) : (
        <div className="prose-tk rounded-lg border border-border p-4" dangerouslySetInnerHTML={{ __html: html }} />
      )}
      <SaveBar count={markdown.trim() ? 1 : 0} noun={['página', 'páginas']} onSave={() => save.mutate()} busy={save.isPending} />
    </div>
  )
}

// ── Mapa mental ─────────────────────────────────────────────────────────────

function Outline({ map, id, depth = 0 }: { map: MindMapData; id: string; depth?: number }) {
  const node = getNode(map, id)!
  const children = childrenOf(map, id)
  return (
    <li>
      <span className={depth === 0 ? 'font-medium' : ''}>{node.text}</span>
      {children.length > 0 && (
        <ul className="ml-4 list-disc pl-2 text-muted">
          {children.map((c) => (
            <Outline key={c.id} map={map} id={c.id} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

function MindmapReview({ initial, source }: { initial: { title: string; data: MindMapData }; source: AiSource }) {
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(initial.title)

  const save = useMutation({
    mutationFn: async () => {
      const name = title.trim() || 'Mapa mental'
      const data = source.lessonId !== null ? setAttachment(initial.data, initial.data.rootId, { kind: 'lesson', id: source.lessonId, title: source.title }) : initial.data
      const id = await window.api.mindmaps.create(name)
      await window.api.mindmaps.save(id, { title: name, data })
      return id
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ['mindmaps'] })
      toast('Mapa mental criado')
      navigate(`/mindmaps/${id}`)
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="ai-map-title">Título do mapa</Label>
        <TextInput id="ai-map-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="rounded-lg border border-border p-4 text-sm">
        <p className="mb-2 flex items-center gap-2 text-xs text-muted">
          <GitFork size={14} className="text-accent" /> {plural(initial.data.nodes.length, 'tópico')} · você pode reorganizar tudo no editor depois de salvar
        </p>
        <ul>
          <Outline map={initial.data} id={initial.data.rootId} />
        </ul>
      </div>
      <SaveBar count={1} noun={['mapa', 'mapas']} onSave={() => save.mutate()} busy={save.isPending} />
    </div>
  )
}

export function ResultReview({ result, source, deckId, bankId }: { result: AiResult; source: AiSource; deckId: number | null; bankId: number | null }) {
  switch (result.task) {
    case 'cards':
      return <CardsReview initial={result.cards} source={source} deckId={deckId} />
    case 'questions':
      return <QuestionsReview initial={result.questions} source={source} bankId={bankId} />
    case 'summary':
      return <SummaryReview initial={result.summary} source={source} />
    case 'mindmap':
      return <MindmapReview initial={result.mindmap} source={source} />
  }
}
