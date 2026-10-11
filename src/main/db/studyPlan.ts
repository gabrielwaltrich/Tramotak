import type { CourseLesson } from '@shared/course'
import { isDateKey } from '@shared/planner'
import { dayKey } from '@shared/streak'
import {
  RECENT_DAYS,
  addDaysKey,
  buildPlan,
  lessonMinutes,
  readPlanSettings,
  typicalVideoSeconds,
  validatePlanSettings,
  type PlanDayView,
  type PlanPreview,
  type PlanResult,
  type PlanSettings,
  type PlanStatus,
  type StudyPlanView
} from '@shared/studyPlan'
import { getCourseDetail, orderedLessons } from './courses'
import { transaction, type Database } from './database'
import { createTask, moveTask } from './planner'

const UPCOMING_DAYS = 7

interface PlanRow {
  id: number
  courseId: number
  courseTitle: string
  settingsJson: string
  createdAt: number
  replannedAt: number | null
}

const PLAN_SELECT = `SELECT p.id, p.course_id AS courseId, c.title AS courseTitle, p.settings_json AS settingsJson,
    p.created_at AS createdAt, p.replanned_at AS replannedAt
  FROM study_plans p JOIN courses c ON c.id = p.course_id`

function planRow(db: Database, courseId: number): PlanRow | undefined {
  return db.prepare(`${PLAN_SELECT} WHERE p.course_id = ?`).get(courseId) as unknown as PlanRow | undefined
}

/** Aulas do curso na ordem de estudo, as que faltam e a duração típica para estimar vídeos sem duração. */
function courseLessons(db: Database, courseId: number) {
  const detail = getCourseDetail(db, courseId)
  const all = orderedLessons(detail)
  return { title: detail.title, all, pending: all.filter((l) => !l.completed), typical: typicalVideoSeconds(all) }
}

function compute(db: Database, courseId: number, settings: PlanSettings, start: string) {
  const { title, pending, typical } = courseLessons(db, courseId)
  const minutes = new Map(pending.map((l) => [l.id, lessonMinutes(l, typical, settings.speed)]))
  const result = buildPlan(
    pending.map((l) => ({ id: l.id, minutes: minutes.get(l.id)! })),
    settings,
    start
  )
  const estimated = pending.filter((l) => l.kind === 'video' && !(l.durationSec && l.durationSec > 0)).length
  return { title, pending, result, estimated }
}

/** "Aula 9" ou "4 aulas · Aula 9 → Aula 12". */
function taskTitle(lessons: CourseLesson[]): string {
  if (lessons.length === 1) return lessons[0].title
  return `${lessons.length} aulas · ${lessons[0].title} → ${lessons[lessons.length - 1].title}`
}

/** Tarefas pendentes do plano cujas aulas já foram todas concluídas passam para "Concluído". */
function closeFinishedTasks(db: Database, planId: number, now: number, onlyLesson?: number): void {
  const candidates = db
    .prepare(
      `SELECT DISTINCT t.id FROM tasks t JOIN plan_lessons pl ON pl.task_id = t.id
        WHERE t.plan_id = ? AND t.status != 'done' ${onlyLesson !== undefined ? 'AND pl.lesson_id = ?' : ''}`
    )
    .all(...(onlyLesson !== undefined ? [planId, onlyLesson] : [planId])) as { id: number }[]
  const missing = db.prepare(
    `SELECT COUNT(*) AS n FROM plan_lessons pl LEFT JOIN lesson_progress p ON p.lesson_id = pl.lesson_id
      WHERE pl.task_id = ? AND p.completed_at IS NULL`
  )
  for (const { id } of candidates) {
    if ((missing.get(id) as { n: number }).n === 0) moveTask(db, id, 'done', Number.MAX_SAFE_INTEGER, now)
  }
}

/** Refaz as tarefas pendentes do plano a partir de `start`. As concluídas ficam como histórico. */
function writeTasks(db: Database, planId: number, courseId: number, settings: PlanSettings, start: string, now: number): PlanResult {
  const { pending, result } = compute(db, courseId, settings, start)
  const byId = new Map(pending.map((l) => [l.id, l]))
  transaction(db, () => {
    closeFinishedTasks(db, planId, now)
    db.prepare("DELETE FROM tasks WHERE plan_id = ? AND status != 'done'").run(planId)
    const link = db.prepare('INSERT INTO plan_lessons (task_id, lesson_id, position) VALUES (?, ?, ?)')
    const setPlan = db.prepare('UPDATE tasks SET plan_id = ? WHERE id = ?')
    for (const day of result.days) {
      const lessons = day.lessonIds.map((id) => byId.get(id)!)
      const task = createTask(
        db,
        {
          title: taskTitle(lessons).slice(0, 300),
          description: lessons.map((l) => `• ${l.title}`).join('\n'),
          scheduledDate: day.date,
          durationMin: Math.min(1440, Math.max(1, Math.round(day.minutes))),
          courseId
        },
        now
      )
      setPlan.run(planId, task.id)
      lessons.forEach((l, position) => link.run(task.id, l.id, position))
    }
  })
  return result
}

/** Dia em que um replanejamento começa: hoje, ou amanhã se a tarefa de hoje do plano já foi concluída. */
function replanStart(db: Database, planId: number, today: string): string {
  const doneToday = db
    .prepare("SELECT 1 FROM tasks WHERE plan_id = ? AND scheduled_date = ? AND status = 'done'")
    .get(planId, today)
  return doneToday ? addDaysKey(today, 1) : today
}

function checkStart(start: string | undefined, today: string): string {
  if (start === undefined || start === null || start === '') return today
  if (!isDateKey(start)) throw new Error('Data de início inválida')
  if (start < today) throw new Error('O plano não pode começar no passado')
  return start
}

/** Minutos por dia que os outros planos pedem daqui em diante (média dos dias com aulas). */
function otherPlansMinutes(db: Database, courseId: number, today: string): number {
  const rows = db
    .prepare(
      `SELECT AVG(t.duration_min) AS avg FROM tasks t JOIN study_plans p ON p.id = t.plan_id
        WHERE p.course_id != ? AND t.status != 'done' AND t.scheduled_date >= ? GROUP BY p.id`
    )
    .all(courseId, today) as { avg: number | null }[]
  return Math.round(rows.reduce((sum, r) => sum + (r.avg ?? 0), 0))
}

export function previewPlan(db: Database, courseId: number, input: unknown, start?: string, now = new Date()): PlanPreview {
  const today = dayKey(now)
  const settings = validatePlanSettings(input, today)
  const { pending, result, estimated } = compute(db, courseId, settings, checkStart(start, today))
  return { result, remainingLessons: pending.length, estimatedLessons: estimated, otherPlansMinutes: otherPlansMinutes(db, courseId, today) }
}

/** Cria ou substitui o plano do curso e gera as tarefas no Planner. */
export function savePlan(db: Database, courseId: number, input: unknown, start?: string, now = new Date()): StudyPlanView {
  const today = dayKey(now)
  const settings = validatePlanSettings(input, today)
  const first = checkStart(start, today)
  const nowSec = Math.floor(now.getTime() / 1000)
  if (courseLessons(db, courseId).pending.length === 0) throw new Error('Todas as aulas deste curso já foram concluídas')
  transaction(db, () => {
    db.prepare(
      `INSERT INTO study_plans (course_id, settings_json, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (course_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at, replanned_at = NULL`
    ).run(courseId, JSON.stringify(settings), nowSec, nowSec)
    writeTasks(db, planRow(db, courseId)!.id, courseId, settings, first, nowSec)
  })
  return getPlan(db, courseId, now)!
}

/** Redistribui as aulas que faltam a partir de hoje, com as mesmas opções. */
export function replan(db: Database, courseId: number, now = new Date()): StudyPlanView {
  const row = planRow(db, courseId)
  if (!row) throw new Error('Este curso não tem plano de estudos')
  const nowSec = Math.floor(now.getTime() / 1000)
  transaction(db, () => {
    writeTasks(db, row.id, courseId, readPlanSettings(row.settingsJson), replanStart(db, row.id, dayKey(now)), nowSec)
    db.prepare('UPDATE study_plans SET replanned_at = ? WHERE id = ?').run(nowSec, row.id)
  })
  return getPlan(db, courseId, now)!
}

/** Apaga o plano e as tarefas pendentes dele; as concluídas ficam no Planner como tarefas comuns. */
export function deletePlan(db: Database, courseId: number): void {
  const row = planRow(db, courseId)
  if (!row) return
  transaction(db, () => {
    db.prepare("DELETE FROM plan_lessons WHERE task_id IN (SELECT id FROM tasks WHERE plan_id = ? AND status = 'done')").run(row.id)
    db.prepare("UPDATE tasks SET plan_id = NULL WHERE plan_id = ? AND status = 'done'").run(row.id)
    db.prepare('DELETE FROM study_plans WHERE id = ?').run(row.id)
  })
}

function behindCount(db: Database, planId: number, today: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT pl.lesson_id) AS n FROM plan_lessons pl
         JOIN tasks t ON t.id = pl.task_id LEFT JOIN lesson_progress p ON p.lesson_id = pl.lesson_id
        WHERE t.plan_id = ? AND t.status != 'done' AND t.scheduled_date < ? AND p.completed_at IS NULL`
    )
    .get(planId, today) as { n: number }
  return row.n
}

function status(db: Database, row: PlanRow, settings: PlanSettings, now: Date): PlanStatus {
  const today = dayKey(now)
  const { all, pending, typical } = courseLessons(db, row.courseId)
  const minutesOf = (l: CourseLesson) => lessonMinutes(l, typical, settings.speed)
  const remainingMinutes = pending.reduce((sum, l) => sum + minutesOf(l), 0)

  const tasks = db
    .prepare('SELECT id, scheduled_date AS date, status, duration_min AS minutes FROM tasks WHERE plan_id = ? ORDER BY scheduled_date, id')
    .all(row.id) as { id: number; date: string; status: string; minutes: number | null }[]
  const links = db
    .prepare(
      `SELECT pl.task_id AS taskId, l.id, l.title, (p.completed_at IS NOT NULL) AS completed
         FROM plan_lessons pl JOIN tasks t ON t.id = pl.task_id JOIN lessons l ON l.id = pl.lesson_id
         LEFT JOIN lesson_progress p ON p.lesson_id = l.id
        WHERE t.plan_id = ? ORDER BY pl.task_id, pl.position`
    )
    .all(row.id) as { taskId: number; id: number; title: string; completed: number }[]
  const lessonsByTask = new Map<number, PlanDayView['lessons']>()
  for (const l of links) {
    const list = lessonsByTask.get(l.taskId) ?? []
    list.push({ id: l.id, title: l.title, completed: Boolean(l.completed) })
    lessonsByTask.set(l.taskId, list)
  }

  const planned = new Set<number>()
  for (const t of tasks) if (t.status !== 'done') for (const l of lessonsByTask.get(t.id) ?? []) planned.add(l.id)

  const ahead = tasks.filter((t) => t.status !== 'done' && t.date >= today)
  const averageMinutes = ahead.length ? ahead.reduce((sum, t) => sum + (t.minutes ?? 0), 0) / ahead.length : 0

  const upcoming: PlanDayView[] = tasks
    .filter((t) => t.date >= today)
    .slice(0, UPCOMING_DAYS)
    .map((t) => ({ taskId: t.id, date: t.date, minutes: t.minutes ?? 0, done: t.status === 'done', lessons: lessonsByTask.get(t.id) ?? [] }))

  // Ritmo real: aulas deste curso concluídas nos últimos 14 dias.
  const since = Math.floor(now.getTime() / 1000) - RECENT_DAYS * 86_400
  const recentIds = new Set(
    (
      db
        .prepare(
          `SELECT l.id FROM lessons l JOIN lesson_progress p ON p.lesson_id = l.id
            WHERE l.course_id = ? AND p.completed_at >= ?`
        )
        .all(row.courseId, since) as { id: number }[]
    ).map((r) => r.id)
  )
  const recentMinutesPerDay = all.filter((l) => recentIds.has(l.id)).reduce((sum, l) => sum + minutesOf(l), 0) / RECENT_DAYS
  const forecastDate =
    pending.length === 0 ? today : recentMinutesPerDay > 0 ? addDaysKey(today, Math.ceil(remainingMinutes / recentMinutesPerDay)) : null

  return {
    remainingLessons: pending.length,
    remainingMinutes,
    behindLessons: behindCount(db, row.id, today),
    unplannedLessons: pending.filter((l) => !planned.has(l.id)).length,
    endDate: tasks.length ? tasks[tasks.length - 1].date : null,
    averageMinutes,
    upcoming,
    recentMinutesPerDay,
    forecastDate
  }
}

function toView(db: Database, row: PlanRow, now: Date): StudyPlanView {
  const settings = readPlanSettings(row.settingsJson)
  return {
    id: row.id,
    courseId: row.courseId,
    courseTitle: row.courseTitle,
    settings,
    createdAt: row.createdAt,
    replannedAt: row.replannedAt,
    status: status(db, row, settings, now)
  }
}

export function getPlan(db: Database, courseId: number, now = new Date()): StudyPlanView | null {
  const row = planRow(db, courseId)
  return row ? toView(db, row, now) : null
}

export function listPlans(db: Database, now = new Date()): StudyPlanView[] {
  const rows = db.prepare(`${PLAN_SELECT} ORDER BY c.title`).all() as unknown as PlanRow[]
  return rows.map((row) => toView(db, row, now))
}

/** Depois de marcar/desmarcar uma aula: conclui as tarefas do plano que ficaram com todas as aulas feitas. */
export function syncPlanTasks(db: Database, lessonId: number, now = Math.floor(Date.now() / 1000)): void {
  const plans = db
    .prepare('SELECT DISTINCT t.plan_id AS planId FROM plan_lessons pl JOIN tasks t ON t.id = pl.task_id WHERE pl.lesson_id = ? AND t.plan_id IS NOT NULL')
    .all(lessonId) as { planId: number }[]
  for (const { planId } of plans) closeFinishedTasks(db, planId, now, lessonId)
}

/**
 * Replaneja os planos com replanejamento automático que ficaram com aulas atrasadas (de dias que passaram).
 * Devolve os cursos replanejados.
 */
export function autoReplan(db: Database, now = new Date()): number[] {
  const today = dayKey(now)
  const rows = db.prepare(`${PLAN_SELECT}`).all() as unknown as PlanRow[]
  const replanned: number[] = []
  for (const row of rows) {
    if (!readPlanSettings(row.settingsJson).autoReplan || behindCount(db, row.id, today) === 0) continue
    replan(db, row.courseId, now)
    replanned.push(row.courseId)
  }
  return replanned
}
