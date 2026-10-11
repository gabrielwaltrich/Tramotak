import type { ChatMessage } from '@shared/ai'
import type { Database } from './database'

/** Mensagens guardadas por aula; acima disso, as mais antigas saem. */
export const MAX_STORED_MESSAGES = 200

export function getChat(db: Database, lessonId: number): ChatMessage[] {
  const row = db.prepare('SELECT messages_json AS m FROM ai_chats WHERE lesson_id = ?').get(lessonId) as { m: string } | undefined
  if (!row) return []
  try {
    const list = JSON.parse(row.m)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function appendChat(db: Database, lessonId: number, messages: ChatMessage[], now = Math.floor(Date.now() / 1000)): ChatMessage[] {
  const all = [...getChat(db, lessonId), ...messages].slice(-MAX_STORED_MESSAGES)
  db.prepare(
    `INSERT INTO ai_chats (lesson_id, messages_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (lesson_id) DO UPDATE SET messages_json = excluded.messages_json, updated_at = excluded.updated_at`
  ).run(lessonId, JSON.stringify(all), now)
  return all
}

export function clearChat(db: Database, lessonId: number): void {
  db.prepare('DELETE FROM ai_chats WHERE lesson_id = ?').run(lessonId)
}
