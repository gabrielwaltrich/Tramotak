import type { Note } from '@shared/course'
import type { Database } from './database'

export const MAX_NOTE_LENGTH = 20_000

const COLUMNS = `id, lesson_id AS lessonId, timestamp_sec AS timestampSec, body_md AS body,
  created_at AS createdAt, updated_at AS updatedAt`

function cleanBody(body: unknown): string {
  const text = String(body ?? '').trim()
  if (!text) throw new Error('A anotação está vazia')
  if (text.length > MAX_NOTE_LENGTH) throw new Error(`A anotação passa de ${MAX_NOTE_LENGTH.toLocaleString('pt-BR')} caracteres`)
  return text
}

function getNote(db: Database, id: number): Note {
  const note = db.prepare(`SELECT ${COLUMNS} FROM notes WHERE id = ?`).get(id) as unknown as Note | undefined
  if (!note) throw new Error('Anotação não encontrada')
  return note
}

/** Notas com horário primeiro, em ordem de vídeo; depois as sem horário, por criação. */
export function listNotes(db: Database, lessonId: number): Note[] {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM notes WHERE lesson_id = ?
        ORDER BY timestamp_sec IS NULL, timestamp_sec, created_at, id`
    )
    .all(lessonId) as unknown as Note[]
}

export function createNote(
  db: Database,
  input: { lessonId: number; timestampSec: number | null; body: string },
  now = Math.floor(Date.now() / 1000)
): Note {
  const lesson = db.prepare('SELECT id FROM lessons WHERE id = ?').get(input.lessonId)
  if (!lesson) throw new Error('Aula não encontrada')
  const timestamp =
    typeof input.timestampSec === 'number' && Number.isFinite(input.timestampSec) ? Math.max(0, input.timestampSec) : null
  const { lastInsertRowid } = db
    .prepare('INSERT INTO notes (lesson_id, timestamp_sec, body_md, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(input.lessonId, timestamp, cleanBody(input.body), now, now)
  return getNote(db, Number(lastInsertRowid))
}

export function updateNote(db: Database, id: number, body: string, now = Math.floor(Date.now() / 1000)): Note {
  const { changes } = db.prepare('UPDATE notes SET body_md = ?, updated_at = ? WHERE id = ?').run(cleanBody(body), now, id)
  if (!changes) throw new Error('Anotação não encontrada')
  return getNote(db, id)
}

export function deleteNote(db: Database, id: number): void {
  db.prepare('DELETE FROM notes WHERE id = ?').run(id)
}
