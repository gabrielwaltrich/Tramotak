import { BookOpen, CalendarClock, Flag } from 'lucide-react'
import type { Task } from '@shared/planner'
import { parseDateKey } from '@shared/planner'
import { dayKey } from '@shared/streak'

/** "hoje", "amanhã", "ontem" ou "12 out". */
export function relativeDay(key: string, today = dayKey(new Date())): string {
  if (key === today) return 'hoje'
  const diff = Math.round((parseDateKey(key).getTime() - parseDateKey(today).getTime()) / 86_400_000)
  if (diff === 1) return 'amanhã'
  if (diff === -1) return 'ontem'
  return parseDateKey(key).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '')
}

/** Linha de detalhes da tarefa: agenda, prazo (vermelho se atrasado) e curso/aula. */
export function TaskMeta({ task, hideDate = false }: { task: Task; hideDate?: boolean }) {
  const today = dayKey(new Date())
  const overdue = task.status !== 'done' && task.dueDate !== null && task.dueDate < today
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      {task.scheduledDate && !hideDate && (
        <span className="inline-flex items-center gap-1">
          <CalendarClock size={12} />
          {relativeDay(task.scheduledDate, today)}
          {task.scheduledTime && ` ${task.scheduledTime}`}
          {task.durationMin && ` · ${task.durationMin} min`}
        </span>
      )}
      {task.scheduledDate && hideDate && task.scheduledTime && (
        <span className="inline-flex items-center gap-1 tabular-nums">
          <CalendarClock size={12} /> {task.scheduledTime}
          {task.durationMin && ` · ${task.durationMin} min`}
        </span>
      )}
      {task.dueDate && (
        <span className={`inline-flex items-center gap-1 ${overdue ? 'font-medium text-red-400' : ''}`}>
          <Flag size={12} /> {overdue ? 'atrasada · ' : 'prazo '}
          {relativeDay(task.dueDate, today)}
        </span>
      )}
      {(task.lessonTitle || task.courseTitle) && (
        <span className="inline-flex min-w-0 items-center gap-1">
          <BookOpen size={12} className="shrink-0" />
          <span className="truncate">{task.lessonTitle ?? task.courseTitle}</span>
        </span>
      )}
    </div>
  )
}
