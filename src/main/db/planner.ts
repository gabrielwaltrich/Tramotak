import { isDateKey, isTime, parseDateKey, type CalendarDay, type Task, type TaskInput, type TaskStatus } from '@shared/planner'
import type { PlanLessonRef } from '@shared/studyPlan'
import { dayKey } from '@shared/streak'
import { transaction, type Database } from './database'

const STATUSES: TaskStatus[] = ['todo', 'doing', 'done']
const MAX_RANGE_DAYS = 400

const nowSec = () => Math.floor(Date.now() / 1000)

const TASK_SELECT = `SELECT t.id, t.title, t.description, t.status, t.position,
    t.scheduled_date AS scheduledDate, t.scheduled_time AS scheduledTime, t.duration_min AS durationMin,
    t.due_date AS dueDate, t.course_id AS courseId, c.title AS courseTitle,
    t.lesson_id AS lessonId, l.title AS lessonTitle, t.completed_at AS completedAt, t.plan_id AS planId
  FROM tasks t LEFT JOIN courses c ON c.id = t.course_id LEFT JOIN lessons l ON l.id = t.lesson_id`

interface CleanInput {
  title: string
  description: string
  scheduledDate: string | null
  scheduledTime: string | null
  durationMin: number | null
  dueDate: string | null
  courseId: number | null
  lessonId: number | null
}

function clean(db: Database, input: TaskInput): CleanInput {
  const title = String(input.title ?? '').trim()
  if (!title) throw new Error('A tarefa precisa de um título')
  const optionalDate = (value: unknown, label: string) => {
    if (value === null || value === undefined || value === '') return null
    if (!isDateKey(value)) throw new Error(`Data inválida em ${label}`)
    return value
  }
  const scheduledDate = optionalDate(input.scheduledDate, 'agendada para')
  const dueDate = optionalDate(input.dueDate, 'prazo')
  let scheduledTime: string | null = null
  if (input.scheduledTime) {
    if (!isTime(input.scheduledTime)) throw new Error('Horário inválido (use HH:MM)')
    if (!scheduledDate) throw new Error('Para ter horário, a tarefa precisa de uma data')
    scheduledTime = input.scheduledTime
  }
  let durationMin: number | null = null
  if (input.durationMin !== null && input.durationMin !== undefined && String(input.durationMin) !== '') {
    const value = Number(input.durationMin)
    if (!Number.isInteger(value) || value < 1 || value > 1440) throw new Error('Duração deve ficar entre 1 e 1440 minutos')
    durationMin = value
  }

  // A aula define o curso; um curso inexistente vira "sem curso".
  let courseId = input.courseId ?? null
  const lessonId = input.lessonId ?? null
  if (lessonId !== null) {
    const lesson = db.prepare('SELECT course_id AS courseId FROM lessons WHERE id = ?').get(lessonId) as { courseId: number } | undefined
    if (!lesson) throw new Error('Aula não encontrada')
    courseId = lesson.courseId
  } else if (courseId !== null && !db.prepare('SELECT 1 FROM courses WHERE id = ?').get(courseId)) {
    throw new Error('Curso não encontrado')
  }

  return { title: title.slice(0, 300), description: String(input.description ?? '').trim(), scheduledDate, scheduledTime, durationMin, dueDate, courseId, lessonId }
}

/** Preenche as aulas das tarefas geradas por planos de estudo (uma consulta para todas). */
function withPlanLessons(db: Database, tasks: Task[]): Task[] {
  const planTasks = tasks.filter((t) => t.planId !== null)
  const byTask = new Map<number, PlanLessonRef[]>()
  if (planTasks.length > 0) {
    const rows = db
      .prepare(
        `SELECT pl.task_id AS taskId, l.id, l.title, (p.completed_at IS NOT NULL) AS completed
           FROM plan_lessons pl JOIN lessons l ON l.id = pl.lesson_id LEFT JOIN lesson_progress p ON p.lesson_id = l.id
          WHERE pl.task_id IN (SELECT value FROM json_each(?)) ORDER BY pl.task_id, pl.position`
      )
      .all(JSON.stringify(planTasks.map((t) => t.id))) as { taskId: number; id: number; title: string; completed: number }[]
    for (const r of rows) {
      const list = byTask.get(r.taskId) ?? []
      list.push({ id: r.id, title: r.title, completed: Boolean(r.completed) })
      byTask.set(r.taskId, list)
    }
  }
  return tasks.map((t) => ({ ...t, planLessons: t.planId !== null ? (byTask.get(t.id) ?? []) : null }))
}

export function getTask(db: Database, id: number): Task {
  const task = db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id) as unknown as Task | undefined
  if (!task) throw new Error('Tarefa não encontrada')
  return withPlanLessons(db, [task])[0]
}

export function listTasks(db: Database): Task[] {
  const tasks = db
    .prepare(`${TASK_SELECT} ORDER BY CASE t.status WHEN 'todo' THEN 0 WHEN 'doing' THEN 1 ELSE 2 END, t.position, t.id`)
    .all() as unknown as Task[]
  return withPlanLessons(db, tasks)
}

function nextPosition(db: Database, status: TaskStatus): number {
  const row = db.prepare('SELECT MAX(position) AS p FROM tasks WHERE status = ?').get(status) as { p: number | null }
  return (row.p ?? -1) + 1
}

export function createTask(db: Database, input: TaskInput, now = nowSec()): Task {
  const status: TaskStatus = STATUSES.includes(input.status as TaskStatus) ? (input.status as TaskStatus) : 'todo'
  const t = clean(db, input)
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO tasks (title, description, status, position, scheduled_date, scheduled_time, duration_min, due_date,
         course_id, lesson_id, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(t.title, t.description, status, nextPosition(db, status), t.scheduledDate, t.scheduledTime, t.durationMin, t.dueDate,
      t.courseId, t.lessonId, status === 'done' ? now : null)
  return getTask(db, Number(lastInsertRowid))
}

/** Substitui os campos editáveis. Mudar data/horário libera um novo aviso de início. */
export function updateTask(db: Database, id: number, input: TaskInput, now = nowSec()): Task {
  const before = getTask(db, id)
  const t = clean(db, input)
  const status: TaskStatus = STATUSES.includes(input.status as TaskStatus) ? (input.status as TaskStatus) : before.status
  const rescheduled = t.scheduledDate !== before.scheduledDate || t.scheduledTime !== before.scheduledTime

  transaction(db, () => {
    db.prepare(
      `UPDATE tasks SET title = ?, description = ?, scheduled_date = ?, scheduled_time = ?, duration_min = ?, due_date = ?,
         course_id = ?, lesson_id = ?, updated_at = ?${rescheduled ? ', notified_at = NULL' : ''} WHERE id = ?`
    ).run(t.title, t.description, t.scheduledDate, t.scheduledTime, t.durationMin, t.dueDate, t.courseId, t.lessonId, now, id)
    if (status !== before.status) moveTask(db, id, status, Number.MAX_SAFE_INTEGER, now)
  })
  return getTask(db, id)
}

/**
 * Move a tarefa para `status` na posição `index` da coluna (arrastar e soltar).
 * Renumera a coluna de destino; concluir marca a data, sair de "Concluído" limpa.
 */
export function moveTask(db: Database, id: number, status: TaskStatus, index: number, now = nowSec()): void {
  if (!STATUSES.includes(status)) throw new Error('Coluna inválida')
  const task = getTask(db, id)
  transaction(db, () => {
    const column = (db.prepare('SELECT id FROM tasks WHERE status = ? AND id != ? ORDER BY position, id').all(status, id) as { id: number }[]).map(
      (r) => r.id
    )
    column.splice(Math.max(0, Math.min(index, column.length)), 0, id)
    const setPosition = db.prepare('UPDATE tasks SET position = ? WHERE id = ?')
    column.forEach((taskId, position) => setPosition.run(position, taskId))
    if (task.status !== status) {
      db.prepare('UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?').run(
        status, status === 'done' ? now : null, now, id
      )
    }
  })
}

export function setTaskDone(db: Database, id: number, done: boolean, now = nowSec()): void {
  moveTask(db, id, done ? 'done' : 'todo', Number.MAX_SAFE_INTEGER, now)
}

export function deleteTask(db: Database, id: number): void {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
}

/** Painel "Hoje": pendentes agendadas para hoje ou com prazo até hoje (atrasadas incluídas). */
export function tasksForToday(db: Database, now = new Date()): Task[] {
  const today = dayKey(now)
  const tasks = db
    .prepare(
      `${TASK_SELECT}
        WHERE t.status != 'done' AND (t.scheduled_date = ? OR t.due_date <= ?)
        ORDER BY t.scheduled_time IS NULL, t.scheduled_time, t.due_date, t.position`
    )
    .all(today, today) as unknown as Task[]
  return withPlanLessons(db, tasks)
}

function addDays(key: string, days: number): string {
  const d = parseDateKey(key)
  d.setDate(d.getDate() + days)
  return dayKey(d)
}

/**
 * Dias de `from` a `to` (inclusive) com tarefas agendadas, prazos e revisões de flashcards previstas.
 * Revisões já vencidas entram no dia de hoje.
 */
export function calendar(db: Database, from: string, to: string, now = new Date()): CalendarDay[] {
  if (!isDateKey(from) || !isDateKey(to) || from > to) throw new Error('Período inválido')
  const days: CalendarDay[] = []
  const index = new Map<string, CalendarDay>()
  for (let key = from; key <= to && days.length < MAX_RANGE_DAYS; key = addDays(key, 1)) {
    const day: CalendarDay = { date: key, tasks: [], dueTasks: [], reviewsDue: 0 }
    days.push(day)
    index.set(key, day)
  }
  const last = days[days.length - 1].date

  const scheduled = db
    .prepare(`${TASK_SELECT} WHERE t.scheduled_date BETWEEN ? AND ? ORDER BY t.scheduled_time IS NULL, t.scheduled_time, t.position`)
    .all(from, last) as unknown as Task[]
  for (const t of withPlanLessons(db, scheduled)) index.get(t.scheduledDate!)?.tasks.push(t)

  const due = db.prepare(`${TASK_SELECT} WHERE t.due_date BETWEEN ? AND ? ORDER BY t.position`).all(from, last) as unknown as Task[]
  for (const t of withPlanLessons(db, due)) index.get(t.dueDate!)?.dueTasks.push(t)

  const today = dayKey(now)
  const end = parseDateKey(addDays(last, 1)).getTime() / 1000
  const cards = db.prepare("SELECT due FROM cards WHERE state != 'new' AND due < ?").all(end) as { due: number }[]
  for (const c of cards) {
    const key = dayKey(new Date(c.due * 1000))
    const day = index.get(key < today ? today : key)
    if (day) day.reviewsDue++
  }
  return days
}

/** Aviso que chega até isso depois do início ainda vale (ex.: app aberto um pouco atrasado). */
const LATE_REMINDER_SEC = 5 * 60

/**
 * Blocos com horário que devem ser avisados agora: começam em até `leadMinutes` ou começaram há pouco,
 * ainda não foram avisados nem concluídos. Marca como avisados.
 */
export function takeBlockReminders(db: Database, now: Date, leadMinutes: number): Task[] {
  const today = dayKey(now)
  const candidates = db
    .prepare(`${TASK_SELECT} WHERE t.status != 'done' AND t.scheduled_date = ? AND t.scheduled_time IS NOT NULL AND t.notified_at IS NULL`)
    .all(today) as unknown as Task[]
  const nowMs = now.getTime()
  const due = candidates.filter((t) => {
    const [h, m] = t.scheduledTime!.split(':').map(Number)
    const start = new Date(now)
    start.setHours(h, m, 0, 0)
    const diff = (start.getTime() - nowMs) / 1000
    return diff <= leadMinutes * 60 && diff >= -LATE_REMINDER_SEC
  })
  const mark = db.prepare('UPDATE tasks SET notified_at = ? WHERE id = ?')
  for (const t of due) mark.run(Math.floor(nowMs / 1000), t.id)
  return withPlanLessons(db, due)
}
