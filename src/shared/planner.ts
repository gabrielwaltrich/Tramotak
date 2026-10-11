import type { PlanLessonRef } from './studyPlan'

export type TaskStatus = 'todo' | 'doing' | 'done'

export interface Task {
  id: number
  title: string
  description: string
  status: TaskStatus
  position: number
  /** Dia local 'AAAA-MM-DD'. */
  scheduledDate: string | null
  /** 'HH:MM'; só faz sentido com `scheduledDate`. */
  scheduledTime: string | null
  durationMin: number | null
  dueDate: string | null
  courseId: number | null
  courseTitle: string | null
  lessonId: number | null
  lessonTitle: string | null
  completedAt: number | null
  /** Tarefa gerada por um plano de estudos (uma por dia, com as aulas do dia). */
  planId: number | null
  planLessons: PlanLessonRef[] | null
}

export interface TaskInput {
  title: string
  description?: string
  status?: TaskStatus
  scheduledDate?: string | null
  scheduledTime?: string | null
  durationMin?: number | null
  dueDate?: string | null
  courseId?: number | null
  lessonId?: number | null
}

/** Um dia do calendário: tarefas agendadas, prazos e revisões de flashcards previstas. */
export interface CalendarDay {
  date: string
  tasks: Task[]
  dueTasks: Task[]
  reviewsDue: number
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = { todo: 'A fazer', doing: 'Fazendo', done: 'Concluído' }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

export function isTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_RE.test(value)
}

/** 'AAAA-MM-DD' → Date à meia-noite local. */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}
