import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Loader2, Sparkles, X } from 'lucide-react'
import type { AiProviderInfo, AiQuestionType } from '@shared/ai'
import { DEFAULT_MAX_TOTAL, MAX_TOTAL_LIMITS, PER_LESSON_LIMITS, type CourseGenerateProgress, type CourseGenerateTask } from '@shared/courseGenerate'
import { plural } from '@shared/format'
import { QUESTION_TYPE_LABEL } from '@shared/questions'
import { errorMessage, queryKeys } from '../../lib/api'
import { Button } from '../Button'
import { Label, Segmented, TextArea } from '../Field'
import { Destination, NEW } from './ResultReview'

const QUESTION_TYPES: AiQuestionType[] = ['single', 'multiple', 'truefalse', 'short']
const NUMBER = 'h-9 w-24 rounded-md border border-border bg-bg px-3 text-sm tabular-nums focus:border-accent focus:outline-none'

const clamp = (n: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, Math.round(n) || min))

/** Andamento da geração do curso (vem do processo principal, que segue mesmo fora desta tela). */
function useCourseProgress(): CourseGenerateProgress | null {
  const [progress, setProgress] = useState<CourseGenerateProgress | null>(null)
  useEffect(() => {
    let alive = true
    void window.api.ai.courseStatus().then((p) => alive && p && setProgress(p))
    const off = window.api.ai.onCourseProgress(setProgress)
    return () => {
      alive = false
      off()
    }
  }, [])
  return progress
}

/**
 * Gerar flashcards ou questões do curso inteiro (ou de módulos): um pedido por aula com material, salvando direto no
 * baralho ou banco escolhido. A IA recebe só o material de cada aula, sem títulos.
 */
export function CourseGenerate({ courseId, info }: { courseId: number | null; info: AiProviderInfo }) {
  const queryClient = useQueryClient()
  const [modules, setModules] = useState<number[]>([])
  const [task, setTask] = useState<CourseGenerateTask>('cards')
  const [perLesson, setPerLesson] = useState(3)
  const [maxTotal, setMaxTotal] = useState(DEFAULT_MAX_TOTAL)
  const [types, setTypes] = useState<AiQuestionType[]>(['single', 'truefalse'])
  const [instructions, setInstructions] = useState('')
  const [target, setTarget] = useState<string>(NEW)
  const [name, setName] = useState('')
  const progress = useCourseProgress()

  // Trocar de curso zera os módulos escolhidos.
  const [seenCourse, setSeenCourse] = useState(courseId)
  if (seenCourse !== courseId) {
    setSeenCourse(courseId)
    setModules([])
  }

  const course = useQuery({ queryKey: queryKeys.course(courseId ?? 0), queryFn: () => window.api.courses.get(courseId!), enabled: courseId !== null })
  const summary = useQuery({
    queryKey: ['ai-course-material', courseId, modules],
    queryFn: () => window.api.ai.courseMaterial(courseId!, modules),
    enabled: courseId !== null,
    staleTime: 0
  })
  const decks = useQuery({ queryKey: queryKeys.decks, queryFn: () => window.api.decks.list(), enabled: task === 'cards' })
  const banks = useQuery({ queryKey: ['banks'], queryFn: () => window.api.banks.list(), enabled: task === 'questions' })

  const running = progress !== null && !progress.finished
  const start = useMutation({
    mutationFn: () =>
      window.api.ai.courseGenerate({
        courseId: courseId!,
        task,
        moduleIds: modules,
        perLesson,
        maxTotal,
        questionTypes: types,
        instructions,
        targetId: target === NEW ? null : Number(target),
        newTitle: name
      }),
    onSuccess: (p) => {
      void queryClient.invalidateQueries({ queryKey: task === 'cards' ? queryKeys.decks : ['banks'] })
      // O baralho ou banco novo fica escolhido: outra rodada continua nele em vez de criar outro igual.
      if (p?.targetId != null) setTarget(String(p.targetId))
    }
  })

  // Ao terminar, as listas de baralhos e bancos mostram os itens novos.
  const finished = progress?.finished ?? false
  useEffect(() => {
    if (finished) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.decks })
      void queryClient.invalidateQueries({ queryKey: ['banks'] })
    }
  }, [finished, queryClient])

  if (courseId === null) return <ProgressCard progress={progress} />

  const s = summary.data
  const planned = s ? Math.min(s.lessons * perLesson, maxTotal) : 0
  const requests = s ? Math.min(s.lessons, Math.ceil(maxTotal / perLesson)) : 0
  const noun = task === 'cards' ? 'carta' : 'questão'
  const defaultName = `${course.data?.title ?? 'Curso'} — ${task === 'cards' ? 'flashcards' : 'questões'} da IA`

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-4 flex items-center gap-2 font-medium">
          <span className="grid size-6 place-items-center rounded-full bg-accent-soft text-xs text-accent">2</span>O que gerar do curso
        </h2>
        <div className="space-y-4">
          {s && s.modules.length > 0 && (
            <fieldset>
              <legend className="mb-2 text-sm text-muted">Módulos (nenhum marcado = o curso inteiro)</legend>
              <div className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-2">
                {s.modules.map((m) => (
                  <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-surface-2">
                    <input
                      type="checkbox"
                      checked={modules.includes(m.id)}
                      onChange={(e) => setModules((list) => (e.target.checked ? [...list, m.id] : list.filter((x) => x !== m.id)))}
                      className="size-4 accent-[var(--accent)]"
                    />
                    <span className="min-w-0 flex-1 truncate">{m.title}</span>
                    <span className="shrink-0 text-xs text-muted tabular-nums">
                      {m.withMaterial}/{m.lessons}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {summary.isPending ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Loader2 size={14} className="animate-spin" /> Lendo as aulas do curso…
            </p>
          ) : s ? (
            <p className="text-sm text-muted">
              {plural(s.lessons, 'aula')} com transcrição, legenda, texto ou PDF, de {s.total} no escopo. As demais ficam de fora
              {s.lessons < s.total && (
                <>
                  {' '}
                  (transcreva pela página do{' '}
                  <Link to={`/courses/${courseId}`} className="text-accent hover:underline">
                    curso
                  </Link>
                  )
                </>
              )}
              .
            </p>
          ) : (
            summary.error && <p className="text-sm text-red-500">{errorMessage(summary.error)}</p>
          )}

          <Segmented
            label="Tipo"
            value={task}
            onChange={(t) => {
              setTask(t)
              setTarget(NEW)
            }}
            options={[
              { value: 'cards', label: 'Flashcards' },
              { value: 'questions', label: 'Questões' }
            ]}
          />
          <div className="flex flex-wrap items-end gap-4 text-sm">
            <div>
              <Label htmlFor="ai-per-lesson">Por aula</Label>
              <input id="ai-per-lesson" type="number" min={PER_LESSON_LIMITS.min} max={PER_LESSON_LIMITS.max} value={perLesson} onChange={(e) => setPerLesson(clamp(Number(e.target.value), PER_LESSON_LIMITS))} className={NUMBER} />
            </div>
            <div>
              <Label htmlFor="ai-max-total">No máximo</Label>
              <input id="ai-max-total" type="number" min={MAX_TOTAL_LIMITS.min} max={MAX_TOTAL_LIMITS.max} value={maxTotal} onChange={(e) => setMaxTotal(clamp(Number(e.target.value), MAX_TOTAL_LIMITS))} className={NUMBER} />
            </div>
            {s && (
              <p className="pb-2 text-muted">
                Até {plural(planned, noun, noun === 'questão' ? 'questões' : 'cartas')} · {plural(requests, 'pedido')} a {info.label}
              </p>
            )}
          </div>
          {task === 'questions' && (
            <fieldset className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <legend className="sr-only">Tipos de questão</legend>
              {QUESTION_TYPES.map((t) => (
                <label key={t} className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={types.includes(t)} onChange={(e) => setTypes((list) => (e.target.checked ? [...list, t] : list.filter((x) => x !== t)))} className="size-4 accent-[var(--accent)]" />
                  {QUESTION_TYPE_LABEL[t]}
                </label>
              ))}
            </fieldset>
          )}
          <div>
            <Label htmlFor="ai-course-instructions">Instruções extras (opcional)</Label>
            <TextArea id="ai-course-instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={1000} placeholder="Ex.: foque nos comandos; nível de certificação" className="min-h-16" />
          </div>
          {task === 'cards' ? (
            <Destination label="Salvar no baralho" id="ai-course-deck" items={decks.data ?? []} value={target} onChange={setTarget} newName={name || defaultName} onNewName={setName} newLabel="Novo baralho…" />
          ) : (
            <Destination label="Salvar no banco de questões" id="ai-course-bank" items={banks.data ?? []} value={target} onChange={setTarget} newName={name || defaultName} onNewName={setName} newLabel="Novo banco…" />
          )}
          <p className="text-xs text-muted">
            Cada aula vira um pedido com só o material dela (sem títulos nem nomes de arquivos). O que for gerado é salvo na hora, com o link para a
            aula; repetidos e itens que falam do vídeo em vez do assunto são descartados. Revise depois no {task === 'cards' ? 'baralho' : 'banco'}.
            {info.cloud ? ` O material vai para ${info.label}.` : ''}
          </p>
          <Button onClick={() => start.mutate()} disabled={!s || s.lessons === 0 || running || start.isPending || (task === 'questions' && types.length === 0)}>
            {start.isPending ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Gerar para {plural(s ? Math.min(s.lessons, requests) : 0, 'aula')}
          </Button>
          {start.error && <p className="text-sm text-red-500">{errorMessage(start.error)}</p>}
        </div>
      </section>
      <ProgressCard progress={progress} />
    </div>
  )
}

function ProgressCard({ progress }: { progress: CourseGenerateProgress | null }) {
  if (!progress) return null
  const running = !progress.finished
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  const link = progress.targetId !== null ? (progress.task === 'cards' ? `/flashcards/${progress.targetId}` : `/questions/${progress.targetId}`) : null
  const noun: [string, string] = progress.task === 'cards' ? ['carta', 'cartas'] : ['questão', 'questões']
  return (
    <section className="rounded-xl border border-border bg-surface p-5" aria-label="Andamento da geração do curso">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        {running ? <Loader2 size={16} className="animate-spin text-accent" /> : progress.error ? <AlertTriangle size={16} className="text-warning" /> : <CheckCircle2 size={16} className="text-success" />}
        {running ? `Gerando… aula ${Math.min(progress.done + 1, progress.total)} de ${progress.total}` : progress.canceled ? 'Interrompido' : progress.error ? 'Parou com erro' : 'Pronto'}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-sm text-muted">
        {plural(progress.saved, noun[0], noun[1])} {progress.saved === 1 ? 'salva' : 'salvas'} em{' '}
        {link ? (
          <Link to={link} className="text-accent hover:underline">
            {progress.targetTitle}
          </Link>
        ) : (
          progress.targetTitle
        )}
        {progress.discarded > 0 && ` · ${progress.discarded} descartadas`}
        {progress.failed > 0 && ` · ${plural(progress.failed, 'aula')} com erro`}
      </p>
      {(progress.error ?? progress.lastError) && <p className="mt-1 text-xs text-warning">{progress.error ?? `Último erro: ${progress.lastError}`}</p>}
      {running && (
        <Button variant="ghost" className="mt-3" onClick={() => window.api.ai.courseCancel()}>
          <X size={16} /> Interromper (o que já foi salvo fica)
        </Button>
      )}
    </section>
  )
}
