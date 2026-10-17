import type { ChatMessage } from '@shared/ai'
import type { Database } from './database'
import { MAX_STORED_MESSAGES } from './chats'

/** Conversa sobre o curso inteiro (uma por curso; some junto com ele). */
export function getCourseChat(db: Database, courseId: number): ChatMessage[] {
  const row = db.prepare('SELECT messages_json AS m FROM course_chats WHERE course_id = ?').get(courseId) as { m: string } | undefined
  if (!row) return []
  try {
    const list = JSON.parse(row.m)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function appendCourseChat(db: Database, courseId: number, messages: ChatMessage[], now = Math.floor(Date.now() / 1000)): ChatMessage[] {
  const all = [...getCourseChat(db, courseId), ...messages].slice(-MAX_STORED_MESSAGES)
  db.prepare(
    `INSERT INTO course_chats (course_id, messages_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (course_id) DO UPDATE SET messages_json = excluded.messages_json, updated_at = excluded.updated_at`
  ).run(courseId, JSON.stringify(all), now)
  return all
}

export function clearCourseChat(db: Database, courseId: number): void {
  db.prepare('DELETE FROM course_chats WHERE course_id = ?').run(courseId)
}
