import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HL_END, HL_START } from '@shared/course'
import { openDatabase, type Database } from '../../src/main/db/database'
import { deleteCourse, insertScannedCourse, revalidateCourse, updateCourse } from '../../src/main/db/courses'
import { createNote, deleteNote, updateNote } from '../../src/main/db/notes'
import { buildFtsQuery, search } from '../../src/main/db/search'
import { scanCourse } from '../../src/main/scanner/scan'
import { makeCourse } from '../helpers/fixture'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

let db: Database
let root: string
let courseId: number
let cleanup: (() => Promise<void>) | undefined

beforeEach(async () => {
  db = openDatabase(':memory:')
  const course = await makeCourse([
    '1. Limites/1. Introdução aos limites.mp4',
    '1. Limites/2. Limites laterais.mp4',
    '2. Derivadas/1. Regra da cadeia.mp4',
    '2. Derivadas/2. Derivada implícita.mp4'
  ])
  root = course.root
  cleanup = course.cleanup
  const scan = await scanCourse(root, { structure: 'auto', numbering: 'dot' })
  courseId = insertScannedCourse(db, { title: 'Cálculo I', rootPath: root, numbering: 'dot', scanStructure: 'auto' }, scan)
})
afterEach(async () => {
  db.close()
  await cleanup?.()
})

const lessonId = (title: string) => (db.prepare('SELECT id FROM lessons WHERE title = ?').get(title) as { id: number }).id
const plain = (s: string | null) => s?.replaceAll(HL_START, '[').replaceAll(HL_END, ']') ?? null
const summary = (q: string) => search(db, q).map((h) => `${h.kind}:${plain(h.title)}`)

describe('buildFtsQuery', () => {
  it.each([
    ['calc', '"calc"*'],
    ['regra cadeia', '"regra"* "cadeia"*'],
    ['  "x" OR y* -z ', '"x"* "OR"* "y"* "z"*'],
    ['a', null],
    ['!!', null],
    ['f(x)', '"f"* "x"*']
  ])('%s → %s', (input, expected) => expect(buildFtsQuery(input)).toBe(expected))
})

describe('search', () => {
  it('ignora acentos e maiúsculas e busca por prefixo', () => {
    expect(summary('calculo')).toEqual(['course:[Cálculo] I'])
    expect(summary('INTRODUCAO')).toEqual(['lesson:[Introdução] aos limites'])
    expect(summary('deriv')).toEqual(expect.arrayContaining(['module:[Derivadas]', 'lesson:[Derivada] implícita']))
  })

  it('exige todas as palavras', () => {
    expect(summary('limites laterais')).toEqual(['lesson:[Limites] [laterais]'])
    expect(summary('limites cadeia')).toEqual([])
  })

  it('traz o contexto de curso e módulo das aulas', () => {
    const [hit] = search(db, 'cadeia')
    expect(hit).toMatchObject({ kind: 'lesson', courseId, courseTitle: 'Cálculo I', moduleTitle: 'Derivadas', lessonId: lessonId('Regra da cadeia'), lessonKind: 'video' })
  })

  it('acha anotações pelo texto, com a aula e o horário', () => {
    createNote(db, { lessonId: lessonId('Regra da cadeia'), timestampSec: 495, body: 'f(g(x)) derivada da composta: multiplicar pelas derivadas internas' })
    const note = search(db, 'composta').find((h) => h.kind === 'note')!
    expect(note).toMatchObject({ title: 'Regra da cadeia', timestampSec: 495, lessonId: lessonId('Regra da cadeia'), moduleTitle: 'Derivadas' })
    expect(plain(note.snippet)).toContain('[composta]')
  })

  it('acompanha edições e exclusões (triggers)', () => {
    const note = createNote(db, { lessonId: lessonId('Regra da cadeia'), timestampSec: 1, body: 'palavra antiga' })
    updateNote(db, note.id, 'palavra nova')
    expect(summary('antiga')).toEqual([])
    expect(summary('nova')).toHaveLength(1)
    deleteNote(db, note.id)
    expect(summary('nova')).toEqual([])

    updateCourse(db, courseId, { title: 'Matemática Básica', description: 'limites e derivadas' })
    expect(summary('matematica')).toEqual(['course:[Matemática] Básica'])
    expect(summary('calculo')).toEqual([])
  })

  it('a descrição do curso também é pesquisável, com trecho', () => {
    updateCourse(db, courseId, { title: 'Cálculo I', description: 'Curso introdutório de funções contínuas' })
    const [hit] = search(db, 'continuas')
    expect(hit.kind).toBe('course')
    expect(plain(hit.snippet)).toContain('[contínuas]')
  })

  it('excluir o curso limpa tudo do índice, inclusive notas (cascata)', () => {
    createNote(db, { lessonId: lessonId('Regra da cadeia'), timestampSec: 1, body: 'nota sobre limites' })
    deleteCourse(db, courseId)
    expect(search(db, 'limites')).toEqual([])
    expect((db.prepare('SELECT COUNT(*) AS n FROM search_index').get() as { n: number }).n).toBe(0)
  })

  it('revalidar remove do índice as aulas apagadas do disco', async () => {
    await rm(join(root, '2. Derivadas', '1. Regra da cadeia.mp4'))
    revalidateCourse(db, courseId, await scanCourse(root, { structure: 'auto', numbering: 'dot' }))
    expect(summary('cadeia')).toEqual([])
  })

  it('consulta curta ou só com símbolos não busca', () => {
    expect(search(db, 'l')).toEqual([])
    expect(search(db, '***')).toEqual([])
  })
})

describe('migration 3 em banco existente', () => {
  it('indexa cursos, aulas e notas criados antes da busca existir', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const { MIGRATIONS } = await import('../../src/main/db/migrations')
    const { migrate } = await import('../../src/main/db/database')
    const old = new DatabaseSync(':memory:')
    old.exec('PRAGMA foreign_keys = ON')
    old.exec(MIGRATIONS[0])
    old.exec(MIGRATIONS[1])
    old.exec('PRAGMA user_version = 2')
    old.exec(`INSERT INTO courses (id, title, root_path, structure, numbering) VALUES (1, 'Física Antiga', '/x', 'flat', 'dot');
              INSERT INTO lessons (id, course_id, title, rel_path, kind, position, file_size, mtime_ms) VALUES (1, 1, 'Cinemática', 'a.mp4', 'video', 0, 1, 1);
              INSERT INTO notes (lesson_id, body_md) VALUES (1, 'velocidade média');`)

    migrate(old)
    expect(search(old, 'fisica').map((h) => h.kind)).toEqual(['course'])
    expect(search(old, 'cinematica').map((h) => h.kind)).toEqual(['lesson'])
    expect(search(old, 'velocidade').map((h) => h.kind)).toEqual(['note'])
    old.close()
  })
})
