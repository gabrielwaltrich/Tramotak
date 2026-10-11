import { isDateKey, parseDateKey } from '@shared/planner'
import type { HistoryEntry, HistoryFilter, ProgressData } from '@shared/progress'
import { matches } from '@shared/search'
import { computeStreak, dayKey, STREAK_MIN_SECONDS } from '@shared/streak'
import type { Database } from './database'
import { getSettings } from './settings'

/** Dias mostrados no mapa de atividade (53 semanas, como o do GitHub). */
export const ACTIVITY_DAYS = 371
const HISTORY_LIMIT = 200
const SCAN_LIMIT = 2000

/** Segundos de estudo por dia local, a partir de `fromSec`. */
export function secondsPerDay(db: Database, fromSec: number): Map<string, number> {
  const rows = db.prepare('SELECT started_at AS startedAt, seconds FROM study_sessions WHERE started_at >= ?').all(fromSec) as {
    startedAt: number
    seconds: number
  }[]
  const perDay = new Map<string, number>()
  for (const r of rows) {
    const key = dayKey(new Date(r.startedAt * 1000))
    perDay.set(key, (perDay.get(key) ?? 0) + r.seconds)
  }
  return perDay
}

function daysAgo(now: Date, days: number): Date {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - days)
  return d
}

const count = (db: Database, sql: string, ...params: number[]) => (db.prepare(sql).get(...params) as { n: number | null }).n ?? 0

export function getProgress(db: Database, now = new Date()): ProgressData {
  const start = daysAgo(now, ACTIVITY_DAYS - 1)
  const perDay = secondsPerDay(db, Math.floor(start.getTime() / 1000))

  const daily = Array.from({ length: ACTIVITY_DAYS }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const key = dayKey(d)
    return { date: key, seconds: perDay.get(key) ?? 0 }
  })
  const activeDays = new Set(daily.filter((d) => d.seconds >= STREAK_MIN_SECONDS).map((d) => d.date))

  const courses = db
    .prepare(
      `SELECT c.id, c.title, COUNT(l.id) AS total, COUNT(p.completed_at) AS completed,
              MAX(p.last_watched_at) AS lastWatched
         FROM courses c
         LEFT JOIN lessons l ON l.course_id = c.id
         LEFT JOIN lesson_progress p ON p.lesson_id = l.id
        GROUP BY c.id
        ORDER BY lastWatched IS NULL, lastWatched DESC, c.title`
    )
    .all() as { id: number; title: string; total: number; completed: number; lastWatched: number | null }[]

  const since30 = Math.floor(daysAgo(now, 29).getTime() / 1000)
  const graduated = db
    .prepare("SELECT COUNT(*) AS n, SUM(rating > 1) AS ok FROM reviews WHERE reviewed_at >= ? AND state_before = 'review'")
    .get(since30) as { n: number; ok: number | null }
  const states = db
    .prepare(
      `SELECT SUM(state = 'new') AS newCount, SUM(state IN ('learning', 'relearning')) AS learning, SUM(state = 'review') AS review
         FROM cards`
    )
    .get() as { newCount: number | null; learning: number | null; review: number | null }

  return {
    goalMinutes: getSettings(db).dailyGoalMinutes,
    streak: computeStreak(activeDays, now),
    totals: {
      studySeconds: count(db, 'SELECT SUM(seconds) AS n FROM study_sessions'),
      lessonsCompleted: count(db, 'SELECT COUNT(*) AS n FROM lesson_progress WHERE completed_at IS NOT NULL'),
      coursesStarted: courses.filter((c) => c.lastWatched !== null || c.completed > 0).length,
      coursesCompleted: courses.filter((c) => c.total > 0 && c.completed === c.total).length,
      notes: count(db, 'SELECT COUNT(*) AS n FROM notes'),
      reviews: count(db, 'SELECT COUNT(*) AS n FROM reviews')
    },
    daily,
    courses: courses.map(({ id, title, total, completed }) => ({ id, title, total, completed })),
    flashcards: {
      cards: { new: states.newCount ?? 0, learning: states.learning ?? 0, review: states.review ?? 0 },
      reviews30d: count(db, 'SELECT COUNT(*) AS n FROM reviews WHERE reviewed_at >= ?', since30),
      retention30d: graduated.n > 0 ? (graduated.ok ?? 0) / graduated.n : null
    }
  }
}

/** Aulas assistidas, da mais recente para a mais antiga, com filtros por curso, texto e período. */
export function watchHistory(db: Database, filter: HistoryFilter = {}): HistoryEntry[] {
  const where = ['p.last_watched_at IS NOT NULL']
  const params: number[] = []
  if (filter.courseId) {
    where.push('l.course_id = ?')
    params.push(filter.courseId)
  }
  if (filter.from) {
    if (!isDateKey(filter.from)) throw new Error('Data inicial inválida')
    where.push('p.last_watched_at >= ?')
    params.push(Math.floor(parseDateKey(filter.from).getTime() / 1000))
  }
  if (filter.to) {
    if (!isDateKey(filter.to)) throw new Error('Data final inválida')
    const end = parseDateKey(filter.to)
    end.setDate(end.getDate() + 1)
    where.push('p.last_watched_at < ?')
    params.push(Math.floor(end.getTime() / 1000))
  }

  const rows = db
    .prepare(
      `SELECT l.id AS lessonId, l.title, l.course_id AS courseId, c.title AS courseTitle, m.title AS moduleTitle,
              p.last_watched_at AS lastWatchedAt, p.position_sec AS positionSec,
              COALESCE(l.duration_sec, p.duration_sec) AS durationSec, (p.completed_at IS NOT NULL) AS completed
         FROM lesson_progress p
         JOIN lessons l ON l.id = p.lesson_id
         JOIN courses c ON c.id = l.course_id
         LEFT JOIN modules m ON m.id = l.module_id
        WHERE ${where.join(' AND ')}
        ORDER BY p.last_watched_at DESC
        LIMIT ${SCAN_LIMIT}`
    )
    .all(...params) as unknown as (Omit<HistoryEntry, 'completed'> & { completed: number })[]

  // O filtro de texto ignora acentos, então roda aqui e não no SQL.
  const text = filter.text?.trim() ?? ''
  return rows
    .filter((r) => matches(text, r.title, r.courseTitle, r.moduleTitle ?? ''))
    .slice(0, HISTORY_LIMIT)
    .map((r) => ({ ...r, completed: Boolean(r.completed) }))
}
