import type { ContinueLesson, DashboardData } from '@shared/course'
import { computeStreak, dayKey, STREAK_MIN_SECONDS } from '@shared/streak'
import { getCourseDetail, orderedLessons } from './courses'
import type { Database } from './database'
import { getSettings } from './settings'

/** Janela de histórico considerada para a sequência e o recorde. */
const HISTORY_DAYS = 400

function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function lessonCard(db: Database, lessonId: number, isNext: boolean): ContinueLesson | null {
  const row = db
    .prepare(
      `SELECT l.id AS lessonId, l.title, l.kind, l.course_id AS courseId, c.title AS courseTitle,
              m.title AS moduleTitle, COALESCE(p.position_sec, 0) AS positionSec, l.duration_sec AS durationSec
         FROM lessons l
         JOIN courses c ON c.id = l.course_id
         LEFT JOIN modules m ON m.id = l.module_id
         LEFT JOIN lesson_progress p ON p.lesson_id = l.id
        WHERE l.id = ?`
    )
    .get(lessonId) as Omit<ContinueLesson, 'isNext'> | undefined
  return row ? { ...row, positionSec: isNext ? 0 : row.positionSec, isNext } : null
}

/**
 * Aula sugerida: a última assistida; se ela já foi concluída, a próxima ainda não concluída do curso
 * (ou ela mesma, se o curso acabou).
 */
export function suggestContinue(db: Database): ContinueLesson | null {
  const last = db
    .prepare(
      `SELECT l.id, l.course_id AS courseId, (p.completed_at IS NOT NULL) AS completed
         FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id
        WHERE p.last_watched_at IS NOT NULL
        ORDER BY p.last_watched_at DESC LIMIT 1`
    )
    .get() as { id: number; courseId: number; completed: number } | undefined
  if (!last) return null
  if (!last.completed) return lessonCard(db, last.id, false)

  const order = orderedLessons(getCourseDetail(db, last.courseId))
  const index = order.findIndex((l) => l.id === last.id)
  const next = order.slice(index + 1).find((l) => !l.completed)
  return next ? lessonCard(db, next.id, true) : lessonCard(db, last.id, false)
}

export function getDashboard(db: Database, now = new Date()): DashboardData {
  const todayStart = Math.floor(startOfDay(now).getTime() / 1000)
  const windowStart = todayStart - HISTORY_DAYS * 86_400

  const sessions = db
    .prepare('SELECT started_at AS startedAt, seconds FROM study_sessions WHERE started_at >= ?')
    .all(windowStart) as { startedAt: number; seconds: number }[]

  const perDay = new Map<string, number>()
  for (const s of sessions) {
    const key = dayKey(new Date(s.startedAt * 1000))
    perDay.set(key, (perDay.get(key) ?? 0) + s.seconds)
  }
  const activeDays = new Set([...perDay].filter(([, sec]) => sec >= STREAK_MIN_SECONDS).map(([key]) => key))

  const completedToday = db
    .prepare('SELECT COUNT(*) AS n FROM lesson_progress WHERE completed_at >= ?')
    .get(todayStart) as { n: number }

  return {
    todaySeconds: perDay.get(dayKey(now)) ?? 0,
    goalMinutes: getSettings(db).dailyGoalMinutes,
    lessonsCompletedToday: completedToday.n,
    streak: computeStreak(activeDays, now),
    continueLesson: suggestContinue(db)
  }
}
