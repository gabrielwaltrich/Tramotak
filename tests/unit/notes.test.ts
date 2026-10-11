import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Database } from '../../src/main/db/database'
import { insertScannedCourse } from '../../src/main/db/courses'
import { createNote, deleteNote, listNotes, MAX_NOTE_LENGTH, updateNote } from '../../src/main/db/notes'
import { scanCourse } from '../../src/main/scanner/scan'
import { makeCourse } from '../helpers/fixture'

let db: Database
let lessonId: number
let cleanup: (() => Promise<void>) | undefined

beforeEach(async () => {
  db = openDatabase(':memory:')
  const course = await makeCourse(['1. Aula.mp4', '2. Outra.mp4'])
  cleanup = course.cleanup
  const scan = await scanCourse(course.root, { structure: 'auto', numbering: 'dot' })
  insertScannedCourse(db, { title: 'C', rootPath: course.root, numbering: 'dot', scanStructure: 'auto' }, scan)
  lessonId = (db.prepare("SELECT id FROM lessons WHERE title = 'Aula'").get() as { id: number }).id
})
afterEach(async () => {
  db.close()
  await cleanup?.()
})

describe('anotações', () => {
  it('cria com horário e texto aparado', () => {
    const note = createNote(db, { lessonId, timestampSec: 495.4, body: '  regra da cadeia  ' }, 1000)
    expect(note).toMatchObject({ lessonId, timestampSec: 495.4, body: 'regra da cadeia', createdAt: 1000, updatedAt: 1000 })
  })

  it('lista em ordem de vídeo, com as sem horário no fim', () => {
    createNote(db, { lessonId, timestampSec: null, body: 'geral' }, 1)
    createNote(db, { lessonId, timestampSec: 300, body: 'b' }, 2)
    createNote(db, { lessonId, timestampSec: 10, body: 'a' }, 3)
    expect(listNotes(db, lessonId).map((n) => n.body)).toEqual(['a', 'b', 'geral'])
  })

  it('separa as notas por aula', () => {
    const other = (db.prepare("SELECT id FROM lessons WHERE title = 'Outra'").get() as { id: number }).id
    createNote(db, { lessonId: other, timestampSec: 1, body: 'x' })
    expect(listNotes(db, lessonId)).toEqual([])
  })

  it('edita o texto e atualiza a data de edição', () => {
    const note = createNote(db, { lessonId, timestampSec: 5, body: 'antes' }, 1000)
    expect(updateNote(db, note.id, 'depois', 2000)).toMatchObject({ body: 'depois', createdAt: 1000, updatedAt: 2000, timestampSec: 5 })
  })

  it('exclui', () => {
    const note = createNote(db, { lessonId, timestampSec: 5, body: 'x' })
    deleteNote(db, note.id)
    expect(listNotes(db, lessonId)).toEqual([])
  })

  it('recusa nota vazia, grande demais, aula ou nota inexistente', () => {
    expect(() => createNote(db, { lessonId, timestampSec: 1, body: '   ' })).toThrow('vazia')
    expect(() => createNote(db, { lessonId, timestampSec: 1, body: 'x'.repeat(MAX_NOTE_LENGTH + 1) })).toThrow('caracteres')
    expect(() => createNote(db, { lessonId: 999, timestampSec: 1, body: 'x' })).toThrow('Aula não encontrada')
    expect(() => updateNote(db, 999, 'x')).toThrow('não encontrada')
  })

  it('normaliza horários inválidos', () => {
    expect(createNote(db, { lessonId, timestampSec: Number.NaN, body: 'a' }).timestampSec).toBeNull()
    expect(createNote(db, { lessonId, timestampSec: -3, body: 'b' }).timestampSec).toBe(0)
  })
})
