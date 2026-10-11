import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrate, openDatabase, schemaVersion, type Database } from '../../src/main/db/database'
import { MIGRATIONS } from '../../src/main/db/migrations'
import { deleteCourse, getCourseTree, insertScannedCourse, listCourses } from '../../src/main/db/courses'
import { scanCourse } from '../../src/main/scanner/scan'
import { makeCourse } from '../helpers/fixture'

let db: Database
let cleanup: (() => Promise<void>) | undefined

beforeEach(() => {
  db = openDatabase(':memory:')
})
afterEach(async () => {
  db.close()
  await cleanup?.()
})

async function importFixture(files: string[]) {
  const course = await makeCourse(files)
  cleanup = course.cleanup
  const scan = await scanCourse(course.root, { structure: 'auto', numbering: 'dot' })
  return insertScannedCourse(db, { title: 'Cálculo I', rootPath: course.root, numbering: 'dot' }, scan)
}

describe('banco', () => {
  it('aplica todas as migrations e é idempotente', () => {
    expect(schemaVersion(db)).toBe(MIGRATIONS.length)
    migrate(db)
    expect(schemaVersion(db)).toBe(MIGRATIONS.length)
  })

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

    const tree = getCourseTree(db, id)
    expect(tree.lessons.map((l) => l.title)).toEqual(['Leia-me'])
    expect(tree.modules.map((m) => m.title)).toEqual(['Cálculo', 'Álgebra'])
    expect(tree.modules[0].children.map((m) => m.title)).toEqual(['Limites', 'Derivadas'])
    expect(tree.modules[1].lessons.map((l) => l.relPath)).toEqual(['2. Álgebra/1. Vetores.mp4'])

    const assets = db.prepare('SELECT kind, rel_path AS relPath FROM lesson_assets').all()
    expect(assets).toEqual([{ kind: 'subtitle', relPath: '1. Cálculo/1. Limites/1. Aula.srt' }])

    expect(listCourses(db)).toEqual([
      expect.objectContaining({ id, title: 'Cálculo I', structure: 'submodules', lessonCount: 6 })
    ])
  })

  it('excluir o curso apaga módulos, aulas, anexos e progresso em cascata', async () => {
    const id = await importFixture(['1. Mod/1. Aula.mp4', '1. Mod/1. Aula.srt'])
    const lessonId = (db.prepare('SELECT id FROM lessons').get() as { id: number }).id
    db.prepare('INSERT INTO lesson_progress (lesson_id, position_sec) VALUES (?, 42)').run(lessonId)
    db.prepare("INSERT INTO notes (lesson_id, body_md) VALUES (?, 'nota')").run(lessonId)

    deleteCourse(db, id)
    for (const table of ['courses', 'modules', 'lessons', 'lesson_assets', 'lesson_progress', 'notes']) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n, table).toBe(0)
    }
  })

  it('desfaz a importação inteira se algo falhar no meio', async () => {
    const course = await makeCourse(['1. Aula.mp4'])
    cleanup = course.cleanup
    const scan = await scanCourse(course.root, { structure: 'auto', numbering: 'dot' })
    scan.lessons.push({ ...scan.lessons[0] }) // rel_path duplicado viola UNIQUE

    expect(() => insertScannedCourse(db, { title: 'X', rootPath: course.root, numbering: 'dot' }, scan)).toThrow()
    expect(listCourses(db)).toEqual([])
  })
})
