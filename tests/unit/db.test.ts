import { rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrate, openDatabase, schemaVersion, type Database } from '../../src/main/db/database'
import { MIGRATIONS } from '../../src/main/db/migrations'
import {
  deleteCourse,
  findCourseByRoot,
  getCourseDetail,
  getCourseRow,
  insertScannedCourse,
  listCourseSummaries,
  orderedLessons,
  revalidateCourse,
  updateCourse
} from '../../src/main/db/courses'
import { scanCourse } from '../../src/main/scanner/scan'
import { makeCourse } from '../helpers/fixture'

let db: Database
let root: string
let cleanup: (() => Promise<void>) | undefined

beforeEach(() => {
  db = openDatabase(':memory:')
})
afterEach(async () => {
  db.close()
  await cleanup?.()
})

const scan = () => scanCourse(root, { structure: 'auto', numbering: 'dot' })
const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
const lessonId = (relPath: string) =>
  (db.prepare('SELECT id FROM lessons WHERE rel_path = ?').get(relPath) as { id: number }).id

async function importFixture(files: string[]) {
  const course = await makeCourse(files)
  root = course.root
  cleanup = course.cleanup
  return insertScannedCourse(db, { title: 'Cálculo I', rootPath: root, numbering: 'dot', scanStructure: 'auto' }, await scan())
}

describe('migrations', () => {
  it('aplica todas e é idempotente', () => {
    expect(schemaVersion(db)).toBe(MIGRATIONS.length)
    migrate(db)
    expect(schemaVersion(db)).toBe(MIGRATIONS.length)
  })
})

describe('importação', () => {
  it('grava o scan e lê a mesma árvore de volta', async () => {
    const id = await importFixture([
      '0. Leia-me.md',
      '1. Cálculo/1. Limites/1. Aula.mp4',
      '1. Cálculo/1. Limites/1. Aula.srt',
      '1. Cálculo/1. Limites/2. Laterais.mp4',
      '1. Cálculo/2. Derivadas/1. Aula.mp4',
      '1. Cálculo/2. Derivadas/2. Cadeia.mp4',
      '2. Álgebra/1. Vetores.mp4'
    ])

    const detail = getCourseDetail(db, id)
    expect(detail.structure).toBe('submodules')
    expect(detail.lessons.map((l) => l.title)).toEqual(['Leia-me'])
    expect(detail.modules.map((m) => m.title)).toEqual(['Cálculo', 'Álgebra'])
    expect(detail.modules[0].children.map((m) => m.title)).toEqual(['Limites', 'Derivadas'])
    expect(orderedLessons(detail).map((l) => l.title)).toEqual([
      'Leia-me', 'Aula', 'Laterais', 'Aula', 'Cadeia', 'Vetores'
    ])
    expect(count('lesson_assets')).toBe(1)
    expect(getCourseRow(db, id).scanStructure).toBe('auto')
    expect(findCourseByRoot(db, root)).toBe(id)
  })

  it('desfaz tudo se algo falhar no meio', async () => {
    const course = await makeCourse(['1. Aula.mp4'])
    root = course.root
    cleanup = course.cleanup
    const result = await scan()
    result.lessons.push({ ...result.lessons[0] }) // rel_path duplicado viola UNIQUE

    expect(() =>
      insertScannedCourse(db, { title: 'X', rootPath: root, numbering: 'dot', scanStructure: 'auto' }, result)
    ).toThrow()
    expect(count('courses')).toBe(0)
  })
})

describe('resumo dos cartões', () => {
  it('conta aulas concluídas, soma duração e escolhe a aula para continuar', async () => {
    const id = await importFixture(['1. A.mp4', '2. B.mp4', '3. C.mp4'])
    expect(listCourseSummaries(db)[0]).toMatchObject({
      id, lessonCount: 3, completedCount: 0, durationSec: 0, resumeLessonId: lessonId('1. A.mp4')
    })

    db.prepare('UPDATE lessons SET duration_sec = 60').run()
    db.prepare('INSERT INTO lesson_progress (lesson_id, completed_at, last_watched_at) VALUES (?, 1, 100)').run(lessonId('1. A.mp4'))
    db.prepare('INSERT INTO lesson_progress (lesson_id, last_watched_at) VALUES (?, 200)').run(lessonId('2. B.mp4'))

    expect(listCourseSummaries(db)[0]).toMatchObject({
      completedCount: 1, durationSec: 180, resumeLessonId: lessonId('2. B.mp4')
    })
  })
})

describe('edição e exclusão', () => {
  it('atualiza título e descrição, recusando título vazio', async () => {
    const id = await importFixture(['1. Aula.mp4'])
    updateCourse(db, id, { title: '  Novo  ', description: ' desc ' })
    expect(getCourseDetail(db, id)).toMatchObject({ title: 'Novo', description: 'desc' })
    expect(() => updateCourse(db, id, { title: '  ', description: '' })).toThrow('vazio')
  })

  it('excluir apaga módulos, aulas, anexos, progresso e notas em cascata', async () => {
    const id = await importFixture(['1. Mod/1. Aula.mp4', '1. Mod/1. Aula.srt'])
    const lesson = lessonId('1. Mod/1. Aula.mp4')
    db.prepare('INSERT INTO lesson_progress (lesson_id, position_sec) VALUES (?, 42)').run(lesson)
    db.prepare("INSERT INTO notes (lesson_id, body_md) VALUES (?, 'nota')").run(lesson)

    deleteCourse(db, id)
    for (const table of ['courses', 'modules', 'lessons', 'lesson_assets', 'lesson_progress', 'notes']) {
      expect(count(table), table).toBe(0)
    }
  })
})

describe('revalidação', () => {
  it('sem mudanças no disco não altera nada', async () => {
    const id = await importFixture(['1. Mod/1. Aula.mp4', '1. Mod/2. Aula.mp4'])
    expect(revalidateCourse(db, id, await scan())).toEqual({ added: 0, removed: 0, updated: 0 })
    expect(count('lessons')).toBe(2)
  })

  it('detecta aulas adicionadas, removidas e alteradas, preservando progresso e notas', async () => {
    const id = await importFixture(['1. Mod/1. Fica.mp4', '1. Mod/2. Sai.mp4', '1. Mod/3. Muda.mp4'])
    const kept = lessonId('1. Mod/1. Fica.mp4')
    db.prepare('INSERT INTO lesson_progress (lesson_id, position_sec) VALUES (?, 42)').run(kept)
    db.prepare("INSERT INTO notes (lesson_id, body_md) VALUES (?, 'nota')").run(kept)
    db.prepare('UPDATE lessons SET duration_sec = 99').run()

    await rm(join(root, '1. Mod', '2. Sai.mp4'))
    await writeFile(join(root, '1. Mod', '3. Muda.mp4'), 'conteúdo maior')
    await writeFile(join(root, '1. Mod', '4. Nova.mp4'), 'x')

    expect(revalidateCourse(db, id, await scan())).toEqual({ added: 1, removed: 1, updated: 1 })
    expect(lessonId('1. Mod/1. Fica.mp4')).toBe(kept)
    expect(count('lesson_progress')).toBe(1)
    expect(count('notes')).toBe(1)
    // A duração da aula alterada é zerada para ser relida no próximo play.
    const muda = db.prepare("SELECT duration_sec AS d FROM lessons WHERE rel_path LIKE '%Muda%'").get() as { d: number | null }
    expect(muda.d).toBeNull()
    expect(orderedLessons(getCourseDetail(db, id)).map((l) => l.title)).toEqual(['Fica', 'Muda', 'Nova'])
  })

  it('renomear a pasta do módulo cria módulo novo e remove o antigo', async () => {
    const id = await importFixture(['1. Velho/1. Aula.mp4'])
    await rename(join(root, '1. Velho'), join(root, '1. Novo'))

    expect(revalidateCourse(db, id, await scan())).toEqual({ added: 1, removed: 1, updated: 0 })
    expect(getCourseDetail(db, id).modules.map((m) => m.title)).toEqual(['Novo'])
    expect(count('modules')).toBe(1)
  })

  it('remover um módulo não afeta as aulas dos outros', async () => {
    const id = await importFixture(['1. A/1. Aula.mp4', '2. B/1. Outra.mp4'])
    const before = lessonId('2. B/1. Outra.mp4')
    await rm(join(root, '1. A'), { recursive: true })

    revalidateCourse(db, id, await scan())
    expect(lessonId('2. B/1. Outra.mp4')).toBe(before)
    expect(getCourseDetail(db, id).modules.map((m) => m.title)).toEqual(['B'])
  })
})

describe('transações aninhadas', () => {
  it('erro interno desfaz só a parte interna; erro externo desfaz tudo', async () => {
    const { transaction } = await import('../../src/main/db/database')
    transaction(db, () => {
      db.exec("INSERT INTO settings (key, value_json) VALUES ('a', '1')")
      expect(() =>
        transaction(db, () => {
          db.exec("INSERT INTO settings (key, value_json) VALUES ('b', '2')")
          throw new Error('falha interna')
        })
      ).toThrow('falha interna')
    })
    expect(db.prepare('SELECT key FROM settings ORDER BY key').all()).toEqual([{ key: 'a' }])

    expect(() =>
      transaction(db, () => {
        transaction(db, () => db.exec("INSERT INTO settings (key, value_json) VALUES ('c', '3')"))
        throw new Error('falha externa')
      })
    ).toThrow('falha externa')
    expect(db.prepare('SELECT key FROM settings ORDER BY key').all()).toEqual([{ key: 'a' }])
  })
})
