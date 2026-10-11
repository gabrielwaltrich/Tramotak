import type { Database } from './database'

/** Sessões separadas por mais que isso viram registros diferentes. */
const SESSION_GAP_SEC = 120

/**
 * Soma `seconds` de estudo terminando em `now`. Junta com a última sessão do mesmo alvo
 * (aula, ou `null` para flashcards) se ela acabou há pouco; senão abre outra.
 */
export function recordStudyTime(db: Database, lessonId: number | null, seconds: number, now: number): void {
  const watched = Math.max(0, Math.round(seconds))
  if (watched === 0) return
  const last = db
    .prepare('SELECT id, ended_at AS endedAt FROM study_sessions WHERE lesson_id IS ? ORDER BY ended_at DESC LIMIT 1')
    .get(lessonId) as { id: number; endedAt: number } | undefined
  if (last && now - last.endedAt <= SESSION_GAP_SEC + watched) {
    db.prepare('UPDATE study_sessions SET ended_at = ?, seconds = seconds + ? WHERE id = ?').run(now, watched, last.id)
  } else {
    db.prepare('INSERT INTO study_sessions (lesson_id, started_at, ended_at, seconds) VALUES (?, ?, ?, ?)').run(
      lessonId, now - watched, now, watched
    )
  }
}
