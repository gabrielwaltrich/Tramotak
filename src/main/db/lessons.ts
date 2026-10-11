import { basename, isAbsolute, relative, resolve } from 'node:path'
import type { LessonView, ProgressUpdate } from '@shared/course'
import { mediaUrl } from '@shared/media'
import { getCourseDetail, orderedLessons } from './courses'
import { transaction, type Database } from './database'

/** Sessões separadas por mais que isso viram registros diferentes. */
const SESSION_GAP_SEC = 120

/** Caminho absoluto dentro da raiz do curso; recusa qualquer coisa que escape dela. */
export function resolveInside(root: string, relPath: string): string {
  const abs = resolve(root, ...relPath.split('/'))
  const rel = relative(root, abs)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Caminho fora da pasta do curso')
  return abs
}

export function lessonFilePath(db: Database, lessonId: number): string {
  const row = db
    .prepare('SELECT c.root_path AS root, l.rel_path AS rel FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ?')
    .get(lessonId) as { root: string; rel: string } | undefined
  if (!row) throw new Error('Aula não encontrada')
  return resolveInside(row.root, row.rel)
}

export function assetFilePath(db: Database, assetId: number): string {
  const row = db
    .prepare(
      `SELECT c.root_path AS root, a.rel_path AS rel FROM lesson_assets a
         JOIN lessons l ON l.id = a.lesson_id JOIN courses c ON c.id = l.course_id WHERE a.id = ?`
    )
    .get(assetId) as { root: string; rel: string } | undefined
  if (!row) throw new Error('Anexo não encontrado')
  return resolveInside(row.root, row.rel)
}

export function getLessonView(db: Database, lessonId: number): LessonView {
  const lesson = db
    .prepare(
      `SELECT l.id, l.course_id AS courseId, l.title, l.kind, l.rel_path AS relPath, l.duration_sec AS durationSec,
              m.title AS moduleTitle, COALESCE(p.position_sec, 0) AS positionSec,
              (p.completed_at IS NOT NULL) AS completed, COALESCE(p.favorite, 0) AS favorite
         FROM lessons l
         LEFT JOIN modules m ON m.id = l.module_id
         LEFT JOIN lesson_progress p ON p.lesson_id = l.id
        WHERE l.id = ?`
    )
    .get(lessonId) as
    | {
        id: number
        courseId: number
        title: string
        kind: LessonView['kind']
        relPath: string
        durationSec: number | null
        moduleTitle: string | null
        positionSec: number
        completed: number
        favorite: number
      }
    | undefined
  if (!lesson) throw new Error('Aula não encontrada')

  const course = getCourseDetail(db, lesson.courseId)
  const order = orderedLessons(course)
  const index = order.findIndex((l) => l.id === lesson.id)
  const neighbor = (i: number) => (order[i] ? { id: order[i].id, title: order[i].title } : null)

  const assets = (
    db
      .prepare('SELECT id, kind, rel_path AS relPath, lang FROM lesson_assets WHERE lesson_id = ? ORDER BY kind DESC, rel_path')
      .all(lesson.id) as unknown as { id: number; kind: 'subtitle' | 'attachment'; relPath: string; lang: string | null }[]
  ).map((a) => ({ id: a.id, kind: a.kind, lang: a.lang, name: basename(a.relPath), url: mediaUrl.asset(a.id) }))

  return {
    id: lesson.id,
    title: lesson.title,
    kind: lesson.kind,
    relPath: lesson.relPath,
    url: mediaUrl.lesson(lesson.id),
    durationSec: lesson.durationSec,
    course: { id: course.id, title: course.title },
    moduleTitle: lesson.moduleTitle,
    assets,
    progress: { positionSec: lesson.positionSec, completed: Boolean(lesson.completed), favorite: Boolean(lesson.favorite) },
    prev: neighbor(index - 1),
    next: neighbor(index + 1)
  }
}

function ensureProgressRow(db: Database, lessonId: number) {
  db.prepare('INSERT INTO lesson_progress (lesson_id) VALUES (?) ON CONFLICT (lesson_id) DO NOTHING').run(lessonId)
}

function assertLesson(db: Database, lessonId: number): number {
  const row = db.prepare('SELECT course_id AS courseId FROM lessons WHERE id = ?').get(lessonId) as
    | { courseId: number }
    | undefined
  if (!row) throw new Error('Aula não encontrada')
  return row.courseId
}

/** Salva posição/duração, marca a aula e o curso como recentes e soma o tempo assistido. */
export function saveProgress(db: Database, update: ProgressUpdate, now = Math.floor(Date.now() / 1000)): void {
  const courseId = assertLesson(db, update.lessonId)
  const position = Math.max(0, update.positionSec)
  const watched = Math.max(0, Math.round(update.watchedSec))

  transaction(db, () => {
    ensureProgressRow(db, update.lessonId)
    db.prepare(
      'UPDATE lesson_progress SET position_sec = ?, duration_sec = COALESCE(?, duration_sec), last_watched_at = ? WHERE lesson_id = ?'
    ).run(position, update.durationSec, now, update.lessonId)
    if (update.durationSec && update.durationSec > 0) {
      db.prepare('UPDATE lessons SET duration_sec = ? WHERE id = ?').run(update.durationSec, update.lessonId)
    }
    db.prepare('UPDATE courses SET last_opened_at = ? WHERE id = ?').run(now, courseId)

    if (watched > 0) {
      const last = db
        .prepare('SELECT id, ended_at AS endedAt FROM study_sessions WHERE lesson_id = ? ORDER BY ended_at DESC LIMIT 1')
        .get(update.lessonId) as { id: number; endedAt: number } | undefined
      if (last && now - last.endedAt <= SESSION_GAP_SEC + watched) {
        db.prepare('UPDATE study_sessions SET ended_at = ?, seconds = seconds + ? WHERE id = ?').run(now, watched, last.id)
      } else {
        db.prepare('INSERT INTO study_sessions (lesson_id, started_at, ended_at, seconds) VALUES (?, ?, ?, ?)').run(
          update.lessonId, now - watched, now, watched
        )
      }
    }
  })
}

export function setCompleted(db: Database, lessonId: number, value: boolean, now = Math.floor(Date.now() / 1000)): void {
  assertLesson(db, lessonId)
  ensureProgressRow(db, lessonId)
  db.prepare('UPDATE lesson_progress SET completed_at = ? WHERE lesson_id = ?').run(value ? now : null, lessonId)
}

export function setFavorite(db: Database, lessonId: number, value: boolean): void {
  assertLesson(db, lessonId)
  ensureProgressRow(db, lessonId)
  db.prepare('UPDATE lesson_progress SET favorite = ? WHERE lesson_id = ?').run(value ? 1 : 0, lessonId)
}

/** Duração lida dos metadados do vídeo sem tocá-lo (preenche o total do curso). */
export function setDuration(db: Database, lessonId: number, durationSec: number): void {
  if (!(durationSec > 0) || !Number.isFinite(durationSec)) return
  db.prepare('UPDATE lessons SET duration_sec = ? WHERE id = ?').run(durationSec, lessonId)
}
