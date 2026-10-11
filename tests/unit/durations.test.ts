import { describe, expect, it } from 'vitest'
import { openDatabase, type Database } from '../../src/main/db/database'
import { DurationScanner, type DurationUpdate } from '../../src/main/media/durations'

function setup(videos: number, withDuration: number[] = []): Database {
  const db = openDatabase(':memory:')
  db.prepare("INSERT INTO courses (id, title, root_path, structure, numbering) VALUES (1, 'C', '/cursos/c', 'flat', 'dot')").run()
  const insert = db.prepare("INSERT INTO lessons (id, course_id, title, rel_path, kind, position, file_size, mtime_ms, duration_sec) VALUES (?, 1, ?, ?, 'video', ?, 1, 1, ?)")
  for (let i = 1; i <= videos; i++) insert.run(i, `Aula ${i}`, `aula-${i}.mp4`, i, withDuration.includes(i) ? 60 : null)
  db.prepare("INSERT INTO lessons (id, course_id, title, rel_path, kind, position, file_size, mtime_ms) VALUES (999, 1, 'Texto', 'leia.md', 'text', 0, 1, 1)").run()
  return db
}

const durations = (db: Database) => (db.prepare('SELECT id, duration_sec AS d FROM lessons WHERE kind = \'video\' ORDER BY id').all() as { id: number; d: number | null }[]).map((r) => r.d)

describe('durações medidas em segundo plano', () => {
  it('preenche só os vídeos sem duração, vários ao mesmo tempo, e avisa no fim', async () => {
    const db = setup(10, [3])
    const read: string[] = []
    let active = 0
    let maxActive = 0
    const updates: DurationUpdate[] = []
    const scanner = new DurationScanner({
      db,
      concurrency: 4,
      readDuration: async (file) => {
        read.push(file)
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise((r) => setTimeout(r, 5))
        active--
        return 120
      },
      onUpdate: (u) => updates.push(u)
    })
    await scanner.request(1)
    expect(read).toHaveLength(9)
    expect(read.every((f) => f.endsWith('.mp4'))).toBe(true)
    expect(maxActive).toBe(4)
    expect(durations(db)).toEqual([120, 120, 60, 120, 120, 120, 120, 120, 120, 120])
    expect(updates.at(-1)).toEqual({ courseId: 1, filled: 9, remaining: 0, done: true })
  })

  it('avisa o progresso no meio (para a lista ir se atualizando)', async () => {
    const db = setup(6)
    const updates: DurationUpdate[] = []
    const scanner = new DurationScanner({
      db,
      concurrency: 1,
      notifyEveryMs: 0,
      readDuration: async () => 30,
      onUpdate: (u) => updates.push(u)
    })
    await scanner.request(1)
    expect(updates.filter((u) => !u.done).map((u) => u.remaining)).toEqual([5, 4, 3, 2, 1, 0])
  })

  it('arquivo ilegível não trava a fila e não é tentado de novo na mesma sessão', async () => {
    const db = setup(3)
    let calls = 0
    const scanner = new DurationScanner({
      db,
      readDuration: async (file) => {
        calls++
        if (file.endsWith('aula-2.mp4')) throw new Error('corrompido')
        return file.endsWith('aula-3.mp4') ? null : 45
      },
      onUpdate: () => undefined
    })
    await scanner.request(1)
    expect(durations(db)).toEqual([45, null, null])
    expect(calls).toBe(3)
    await scanner.request(1)
    expect(calls).toBe(3)
  })

  it('caminho que escapa da pasta do curso conta como falha, sem derrubar as outras', async () => {
    const db = setup(2)
    db.prepare("UPDATE lessons SET rel_path = '../fora.mp4' WHERE id = 1").run()
    const scanner = new DurationScanner({ db, readDuration: async () => 50, onUpdate: () => undefined })
    await scanner.request(1)
    expect(durations(db)).toEqual([null, 50])
  })

  it('requestAll agenda todos os cursos com vídeos sem duração; pedidos repetidos não duplicam trabalho', async () => {
    const db = setup(2)
    db.prepare("INSERT INTO courses (id, title, root_path, structure, numbering) VALUES (2, 'D', '/cursos/d', 'flat', 'dot')").run()
    db.prepare("INSERT INTO lessons (course_id, title, rel_path, kind, position, file_size, mtime_ms) VALUES (2, 'X', 'x.mp4', 'video', 0, 1, 1)").run()
    let calls = 0
    const scanner = new DurationScanner({
      db,
      readDuration: async () => {
        calls++
        return 10
      },
      onUpdate: () => undefined
    })
    await Promise.all([scanner.requestAll(), scanner.request(1), scanner.request(2)])
    expect(calls).toBe(3)
    expect((db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE kind = 'video' AND duration_sec IS NULL").get() as { n: number }).n).toBe(0)
  })
})
