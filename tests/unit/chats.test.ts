import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { appendChat, clearChat, getChat, MAX_STORED_MESSAGES } from '../../src/main/db/chats'

function setup() {
  const db = openDatabase(':memory:')
  db.prepare("INSERT INTO courses (id, title, root_path, structure, numbering) VALUES (1, 'C', '/c', 'flat', 'dot')").run()
  db.prepare("INSERT INTO lessons (id, course_id, title, rel_path, kind, position, file_size, mtime_ms) VALUES (7, 1, 'A', 'a.mp4', 'video', 0, 1, 1)").run()
  return db
}

describe('conversas salvas por aula', () => {
  it('acrescenta, limita o tamanho e limpa', () => {
    const db = setup()
    expect(getChat(db, 7)).toEqual([])
    appendChat(db, 7, [{ role: 'user', content: 'oi', at: 1 }, { role: 'assistant', content: 'olá', at: 2, sources: [{ url: 'https://x.y', title: 'X' }] }])
    expect(getChat(db, 7).map((m) => m.content)).toEqual(['oi', 'olá'])
    appendChat(db, 7, Array.from({ length: MAX_STORED_MESSAGES }, (_, i) => ({ role: 'user' as const, content: `m${i}`, at: i })))
    const all = getChat(db, 7)
    expect(all).toHaveLength(MAX_STORED_MESSAGES)
    expect(all.at(-1)!.content).toBe(`m${MAX_STORED_MESSAGES - 1}`)
    clearChat(db, 7)
    expect(getChat(db, 7)).toEqual([])
  })

  it('some junto com a aula', () => {
    const db = setup()
    appendChat(db, 7, [{ role: 'user', content: 'oi', at: 1 }])
    db.prepare('DELETE FROM lessons WHERE id = 7').run()
    expect(getChat(db, 7)).toEqual([])
  })
})
