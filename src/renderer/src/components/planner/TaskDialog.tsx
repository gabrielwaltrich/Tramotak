import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { TASK_STATUS_LABEL, type Task, type TaskInput, type TaskStatus } from '@shared/planner'
import { errorMessage, queryKeys } from '../../lib/api'
import { Modal } from '../Modal'
import { Button } from '../Button'
import { Label, TextArea, TextInput } from '../Field'
import { useToast } from '../Toast'

export type TaskDialogState = { mode: 'create'; preset?: Partial<TaskInput> } | { mode: 'edit'; task: Task } | null

const SELECT = 'h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-text disabled:opacity-50'

export function TaskDialog({ state, onClose }: { state: TaskDialogState; onClose: () => void }) {
  const title = state?.mode === 'edit' ? 'Editar tarefa' : 'Nova tarefa'
  return (
    <Modal open={state !== null} onClose={onClose} title={title} wide>
      {state && <TaskForm key={state.mode === 'edit' ? state.task.id : 'nova'} state={state} onClose={onClose} />}
    </Modal>
  )
}

function TaskForm({ state, onClose }: { state: NonNullable<TaskDialogState>; onClose: () => void }) {
  const initial: TaskInput = state.mode === 'edit' ? state.task : { title: '', status: 'todo', ...state.preset }
  const [form, setForm] = useState({
    title: initial.title ?? '',
    description: initial.description ?? '',
    status: (initial.status ?? 'todo') as TaskStatus,
    scheduledDate: initial.scheduledDate ?? '',
    scheduledTime: initial.scheduledTime ?? '',
    durationMin: initial.durationMin ? String(initial.durationMin) : '',
    dueDate: initial.dueDate ?? '',
    courseId: initial.courseId ? String(initial.courseId) : '',
    lessonId: initial.lessonId ? String(initial.lessonId) : ''
  })
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }))
  const queryClient = useQueryClient()
  const toast = useToast()

  const courses = useQuery({ queryKey: queryKeys.courses, queryFn: () => window.api.courses.list() })
  const courseId = form.courseId ? Number(form.courseId) : null
  const course = useQuery({
    queryKey: queryKeys.course(courseId ?? -1),
    queryFn: () => window.api.courses.get(courseId!),
    enabled: courseId !== null
  })

  const lessons = (() => {
    if (!course.data) return []
    const out: { id: number; label: string }[] = course.data.lessons.map((l) => ({ id: l.id, label: l.title }))
    const walk = (mods: typeof course.data.modules, prefix: string) => {
      for (const m of mods) {
        out.push(...m.lessons.map((l) => ({ id: l.id, label: `${prefix}${m.title} · ${l.title}` })))
        walk(m.children, `${prefix}${m.title} › `)
      }
    }
    walk(course.data.modules, '')
    return out
  })()

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.tasks })
  const input = (): TaskInput => ({
    title: form.title,
    description: form.description,
    status: form.status,
    scheduledDate: form.scheduledDate || null,
    scheduledTime: form.scheduledDate && form.scheduledTime ? form.scheduledTime : null,
    durationMin: form.durationMin ? Number(form.durationMin) : null,
    dueDate: form.dueDate || null,
    courseId,
    lessonId: form.lessonId ? Number(form.lessonId) : null
  })

  const save = useMutation({
    mutationFn: () => (state.mode === 'edit' ? window.api.tasks.update(state.task.id, input()) : window.api.tasks.create(input())),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  const remove = useMutation({
    mutationFn: () => window.api.tasks.delete((state as { task: Task }).task.id),
    onSuccess: async () => {
      await refresh()
      toast('Tarefa excluída')
      onClose()
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <div>
        <Label htmlFor="task-title">Título</Label>
        <TextInput id="task-title" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Ex.: Revisar o módulo de limites" data-autofocus />
      </div>
      <div>
        <Label htmlFor="task-description">Descrição</Label>
        <TextArea id="task-description" value={form.description} onChange={(e) => set('description', e.target.value)} className="min-h-16" />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div>
          <Label htmlFor="task-status">Status</Label>
          <select id="task-status" value={form.status} onChange={(e) => set('status', e.target.value as TaskStatus)} className={SELECT}>
            {(Object.keys(TASK_STATUS_LABEL) as TaskStatus[]).map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="task-date">Agendada para</Label>
          <TextInput id="task-date" type="date" value={form.scheduledDate} onChange={(e) => set('scheduledDate', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="task-time">Horário</Label>
          <TextInput id="task-time" type="time" value={form.scheduledTime} onChange={(e) => set('scheduledTime', e.target.value)} disabled={!form.scheduledDate} title={form.scheduledDate ? undefined : 'Escolha uma data primeiro'} />
        </div>
        <div>
          <Label htmlFor="task-duration">Duração (min)</Label>
          <TextInput id="task-duration" type="number" min={1} max={1440} step={1} value={form.durationMin} onChange={(e) => set('durationMin', e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-[10rem_1fr_1fr]">
        <div>
          <Label htmlFor="task-due">Prazo</Label>
          <TextInput id="task-due" type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="task-course">Curso</Label>
          <select
            id="task-course"
            value={form.courseId}
            onChange={(e) => setForm((f) => ({ ...f, courseId: e.target.value, lessonId: '' }))}
            className={SELECT}
          >
            <option value="">Nenhum</option>
            {courses.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="task-lesson">Aula</Label>
          <select id="task-lesson" value={form.lessonId} onChange={(e) => set('lessonId', e.target.value)} className={SELECT} disabled={!courseId}>
            <option value="">Nenhuma</option>
            {lessons.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-xs text-muted">Com data e horário, você recebe um aviso antes do bloco começar (ajuste em Configurações).</p>

      <div className="flex items-center justify-between">
        {state.mode === 'edit' ? (
          <Button variant="ghost" onClick={() => remove.mutate()} disabled={remove.isPending} className="text-red-400">
            <Trash2 size={16} /> Excluir
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!form.title.trim() || save.isPending}>
            {state.mode === 'edit' ? 'Salvar' : 'Criar tarefa'}
          </Button>
        </div>
      </div>
    </form>
  )
}
