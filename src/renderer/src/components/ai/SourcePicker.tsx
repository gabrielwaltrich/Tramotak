import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, FileText, Loader2 } from 'lucide-react'
import { composeMaterial, type AiSectionKind, type AiSource, type AiSourceRef } from '@shared/ai'
import type { CourseDetail, CourseLesson } from '@shared/course'
import { errorMessage, queryKeys } from '../../lib/api'
import { Label, Segmented, TextArea, TextInput } from '../Field'

export type SourceMode = 'lesson' | 'course' | 'page' | 'text'

export interface SourceState {
  mode: SourceMode
  courseId: number | null
  lessonId: number | null
  notebookId: number | null
  pageId: number | null
  pastedTitle: string
  pastedText: string
  /** Partes do material marcadas (`null` = as marcadas por padrão). */
  sections: AiSectionKind[] | null
}

const SELECT = 'h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-text disabled:opacity-50'

/** Aulas na ordem de estudo, com o módulo no rótulo. */
function flatLessons(course: CourseDetail): { lesson: CourseLesson; module: string | null }[] {
  const out: { lesson: CourseLesson; module: string | null }[] = course.lessons.map((lesson) => ({ lesson, module: null }))
  const walk = (mods: CourseDetail['modules'], prefix: string) => {
    for (const m of mods) {
      const name = prefix ? `${prefix} › ${m.title}` : m.title
      out.push(...m.lessons.map((lesson) => ({ lesson, module: name })))
      walk(m.children, name)
    }
  }
  walk(course.modules, '')
  return out
}

/** Partes marcadas: as escolhidas pela pessoa ou, sem escolha, as marcadas por padrão. */
export function selectedSections(state: SourceState, source: AiSource | null): AiSectionKind[] {
  if (!source) return []
  const available = source.sections.map((s) => s.kind)
  return state.sections === null ? source.sections.filter((s) => s.defaultOn).map((s) => s.kind) : state.sections.filter((k) => available.includes(k))
}

export function sourceRef(state: SourceState): AiSourceRef | null {
  if (state.mode === 'lesson' && state.lessonId) return { kind: 'lesson', id: state.lessonId }
  if (state.mode === 'page' && state.pageId) return { kind: 'page', id: state.pageId }
  return null
}

/** Material pronto para mandar (ou `null` se ainda falta escolher). */
export function useSource(state: SourceState): { source: AiSource | null; loading: boolean; error: string | null } {
  const ref = sourceRef(state)
  const query = useQuery({
    queryKey: ['ai-source', ref?.kind, ref?.id],
    queryFn: () => window.api.ai.source(ref!),
    enabled: ref !== null,
    staleTime: 0
  })
  if (state.mode === 'text') {
    const text = state.pastedText.trim()
    return {
      source: text
        ? { title: state.pastedTitle.trim() || 'Texto colado', sections: [{ kind: 'pasted', label: 'Texto colado', text, defaultOn: true }], lessonId: null, courseId: null }
        : null,
      loading: false,
      error: null
    }
  }
  return { source: ref ? (query.data ?? null) : null, loading: ref !== null && query.isPending, error: query.error ? errorMessage(query.error) : null }
}

export function SourcePicker({ state, onChange, source, loading, error, maxChars }: {
  state: SourceState
  onChange: (patch: Partial<SourceState>) => void
  source: AiSource | null
  loading: boolean
  error: string | null
  maxChars: number
}) {
  const courses = useQuery({ queryKey: queryKeys.courses, queryFn: () => window.api.courses.list(), enabled: state.mode === 'lesson' || state.mode === 'course' })
  const course = useQuery({
    queryKey: queryKeys.course(state.courseId ?? 0),
    queryFn: () => window.api.courses.get(state.courseId!),
    enabled: state.mode === 'lesson' && state.courseId !== null
  })
  const notebooks = useQuery({ queryKey: ['notebooks'], queryFn: () => window.api.notebooks.list(), enabled: state.mode === 'page' })
  const notebook = useQuery({
    queryKey: ['notebooks', state.notebookId],
    queryFn: () => window.api.notebooks.get(state.notebookId!),
    enabled: state.mode === 'page' && state.notebookId !== null
  })

  // Chegou só com a aula (link do player): descobre o curso dela.
  const lessonView = useQuery({
    queryKey: queryKeys.lesson(state.lessonId ?? 0),
    queryFn: () => window.api.lessons.get(state.lessonId!),
    enabled: state.mode === 'lesson' && state.lessonId !== null && state.courseId === null
  })
  useEffect(() => {
    if (lessonView.data && state.courseId === null) onChange({ courseId: lessonView.data.course.id })
  }, [lessonView.data, state.courseId, onChange])

  const lessons = course.data ? flatLessons(course.data) : []
  const chosen = selectedSections(state, source)
  const total = source ? composeMaterial(source.sections, chosen).length : 0
  const toggle = (kind: AiSectionKind, on: boolean) => onChange({ sections: on ? [...chosen, kind] : chosen.filter((k) => k !== kind) })

  return (
    <div className="space-y-4">
      <Segmented
        label="Origem do material"
        value={state.mode}
        onChange={(mode) => onChange({ mode, sections: null })}
        options={[
          { value: 'lesson', label: 'Aula' },
          { value: 'course', label: 'Curso inteiro' },
          { value: 'page', label: 'Página de caderno' },
          { value: 'text', label: 'Colar texto' }
        ]}
      />

      {state.mode === 'lesson' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="ai-course">Curso</Label>
            <select
              id="ai-course"
              className={SELECT}
              value={state.courseId ?? ''}
              onChange={(e) => onChange({ courseId: e.target.value ? Number(e.target.value) : null, lessonId: null, sections: null })}
            >
              <option value="">Escolha um curso…</option>
              {courses.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="ai-lesson">Aula</Label>
            <select
              id="ai-lesson"
              className={SELECT}
              disabled={!course.data}
              value={state.lessonId ?? ''}
              onChange={(e) => onChange({ lessonId: e.target.value ? Number(e.target.value) : null, sections: null })}
            >
              <option value="">Escolha uma aula…</option>
              {lessons.map(({ lesson, module }) => (
                <option key={lesson.id} value={lesson.id}>
                  {module ? `${module} › ` : ''}
                  {lesson.title}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {state.mode === 'course' && (
        <div>
          <Label htmlFor="ai-course-all">Curso</Label>
          <select
            id="ai-course-all"
            className={SELECT}
            value={state.courseId ?? ''}
            onChange={(e) => onChange({ courseId: e.target.value ? Number(e.target.value) : null, lessonId: null, sections: null })}
          >
            <option value="">Escolha um curso…</option>
            {courses.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
      )}

      {state.mode === 'page' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="ai-notebook">Caderno</Label>
            <select
              id="ai-notebook"
              className={SELECT}
              value={state.notebookId ?? ''}
              onChange={(e) => onChange({ notebookId: e.target.value ? Number(e.target.value) : null, pageId: null, sections: null })}
            >
              <option value="">Escolha um caderno…</option>
              {notebooks.data?.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="ai-page">Página</Label>
            <select
              id="ai-page"
              className={SELECT}
              disabled={!notebook.data}
              value={state.pageId ?? ''}
              onChange={(e) => onChange({ pageId: e.target.value ? Number(e.target.value) : null, sections: null })}
            >
              <option value="">Escolha uma página…</option>
              {notebook.data?.pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title || 'Sem título'}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {state.mode === 'text' && (
        <div className="space-y-3">
          <div>
            <Label htmlFor="ai-title">Assunto (opcional)</Label>
            <TextInput id="ai-title" value={state.pastedTitle} onChange={(e) => onChange({ pastedTitle: e.target.value })} placeholder="Ex.: Revolução Francesa" />
          </div>
          <div>
            <Label htmlFor="ai-text">Texto</Label>
            <TextArea id="ai-text" value={state.pastedText} onChange={(e) => onChange({ pastedText: e.target.value })} placeholder="Cole aqui um trecho de apostila, artigo ou anotação…" className="min-h-40" />
          </div>
        </div>
      )}

      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={14} className="animate-spin" /> Lendo o material…
        </p>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {source && state.mode !== 'text' && (
        <div className="rounded-lg border border-border bg-bg/50 p-3 text-sm">
          {source.sections.length === 0 ? (
            <p className="flex items-start gap-2 text-warning">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              {state.mode === 'lesson'
                ? 'Esta aula ainda não tem texto para a IA ler. Transcreva o vídeo no player (aba Transcrição), escreva anotações ou cole o texto.'
                : 'Esta página não tem blocos de texto.'}
            </p>
          ) : (
            <>
              <p className="mb-2 flex items-center gap-2 font-medium">
                <FileText size={14} className="text-accent" /> {source.title}
              </p>
              <ul className="space-y-1">
                {source.sections.map((p) => (
                  <li key={p.kind}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input type="checkbox" checked={chosen.includes(p.kind)} onChange={(e) => toggle(p.kind, e.target.checked)} className="size-4 accent-[var(--accent)]" />
                      {p.label}
                      <span className="text-xs text-muted">· {p.text.trim().length.toLocaleString('pt-BR')} caracteres</span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">
                A IA recebe só o conteúdo marcado. Título da aula, nome do curso, nomes de arquivos e outros metadados não são enviados.
              </p>
            </>
          )}
        </div>
      )}

      {total > maxChars && (
        <p className="flex items-start gap-2 text-xs text-warning">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          O material tem {total.toLocaleString('pt-BR')} caracteres; só os primeiros {maxChars.toLocaleString('pt-BR')} cabem num pedido a este provedor.
        </p>
      )}
    </div>
  )
}
