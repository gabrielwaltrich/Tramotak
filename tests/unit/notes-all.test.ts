import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupByLesson, noteLink, noteMarkdown, notesToMarkdown, suggestedPageTitle } from '@shared/notes'
import { openDatabase, type Database } from '../../src/main/db/database'
import { deleteCourse, insertScannedCourse } from '../../src/main/db/courses'
import { createNote, listAllNotes, sendNotesToNotebook } from '../../src/main/db/notes'
import { createNotebook, getNotebook, getPage, notebookPages } from '../../src/main/db/notebooks'
import { scanCourse } from '../../src/main/scanner/scan'
import { makeCourse } from '../helpers/fixture'

let db: Database
const cleanups: (() => Promise<void>)[] = []
let lesson: (title: string) => number
let calc: number

async function addCourse(title: string, files: string[]): Promise<number> {
  const course = await makeCourse(files)
  cleanups.push(course.cleanup)
  const scan = await scanCourse(course.root, { structure: 'auto', numbering: 'dot' })
  return insertScannedCourse(db, { title, rootPath: course.root, numbering: 'dot', scanStructure: 'auto' }, scan)
}

beforeEach(async () => {
  db = openDatabase(':memory:')
  calc = await addCourse('Cálculo', ['1. Limites/1. Ideia.mp4', '1. Limites/2. Laterais.mp4', '2. Derivadas/1. Definição.mp4'])
  await addCourse('Álgebra', ['1. Vetores.mp4'])
  lesson = (title) => (db.prepare('SELECT id FROM lessons WHERE title = ?').get(title) as { id: number }).id
})
afterEach(async () => {
  db.close()
  for (const c of cleanups.splice(0)) await c()
})

describe('todas as anotações', () => {
  it('juntam curso, módulos e aula, na ordem do curso e do vídeo', () => {
    createNote(db, { lessonId: lesson('Definição'), timestampSec: 10, body: 'derivada' }, 100)
    createNote(db, { lessonId: lesson('Ideia'), timestampSec: 90, body: 'depois' }, 101)
    createNote(db, { lessonId: lesson('Ideia'), timestampSec: 5, body: 'antes' }, 102)
    createNote(db, { lessonId: lesson('Ideia'), timestampSec: null, body: 'sem horário' }, 103)
    createNote(db, { lessonId: lesson('Vetores'), timestampSec: 1, body: 'vetor' }, 104)

    const all = listAllNotes(db)
    expect(all.map((n) => n.body)).toEqual(['vetor', 'antes', 'depois', 'sem horário', 'derivada'])
    expect(all[1]).toMatchObject({ courseTitle: 'Cálculo', lessonTitle: 'Ideia', modulePath: ['Limites'], lessonKind: 'video' })
    expect(listAllNotes(db, calc).map((n) => n.body)).toEqual(['antes', 'depois', 'sem horário', 'derivada'])

    const groups = groupByLesson(all)
    expect(groups.map((g) => [g.lessonTitle, g.notes.length])).toEqual([
      ['Vetores', 1],
      ['Ideia', 3],
      ['Definição', 1]
    ])

    deleteCourse(db, calc)
    expect(listAllNotes(db).map((n) => n.body)).toEqual(['vetor'])
  })

  it('Markdown com horários e títulos sugeridos', () => {
    createNote(db, { lessonId: lesson('Ideia'), timestampSec: 125.7, body: 'limite\ncontinua aqui' })
    createNote(db, { lessonId: lesson('Laterais'), timestampSec: null, body: 'pela esquerda' })
    const all = listAllNotes(db, calc)
    expect(noteLink(lesson('Ideia'), 125.7)).toBe(`#/lesson/${lesson('Ideia')}?t=125`)
    expect(noteMarkdown(all[0])).toBe(`- [**2:05**](#/lesson/${lesson('Ideia')}?t=125) limite\n  continua aqui`)
    expect(noteMarkdown(all[0], false)).toBe('- **2:05** limite\n  continua aqui')
    expect(notesToMarkdown(all)).toBe('## Limites › Ideia\n\n- **2:05** limite\n  continua aqui\n\n## Limites › Laterais\n\n- pela esquerda\n')
    expect(suggestedPageTitle(all)).toBe('Anotações · Cálculo')
    expect(suggestedPageTitle(all.slice(0, 1))).toBe('Ideia')
    createNote(db, { lessonId: lesson('Vetores'), timestampSec: 3, body: 'vetor' })
    expect(suggestedPageTitle(listAllNotes(db))).toBe('Anotações')
    expect(notesToMarkdown(listAllNotes(db))).toMatch(/^# Álgebra\n\n## Vetores[\s\S]*# Cálculo\n/)
  })
})

describe('enviar para caderno', () => {
  it('caderno novo: um atalho por aula seguido das notas, na primeira página', () => {
    const a = createNote(db, { lessonId: lesson('Ideia'), timestampSec: 5, body: 'antes' })
    const b = createNote(db, { lessonId: lesson('Definição'), timestampSec: 70, body: 'derivada' })
    const result = sendNotesToNotebook(db, { noteIds: [b.id, a.id], notebookId: null, notebookTitle: 'Resumo de Cálculo', pageId: null })
    expect(result.notes).toBe(2)
    const notebook = getNotebook(db, result.notebookId)
    expect(notebook.title).toBe('Resumo de Cálculo')
    expect(notebook.pages).toHaveLength(1)
    const page = getPage(db, result.pageId)
    expect(page.title).toBe('Anotações · Cálculo')
    expect(page.blocks.map((x) => (x.type === 'resource' ? `aula:${x.resource.title}` : x.type === 'text' ? x.text : x.type))).toEqual([
      'aula:Ideia',
      `- [**0:05**](#/lesson/${lesson('Ideia')}?t=5) antes`,
      'aula:Definição',
      `- [**1:10**](#/lesson/${lesson('Definição')}?t=70) derivada`
    ])
  })

  it('página existente: entra no fim, sem apagar o que já havia; vários cursos ganham títulos', () => {
    const notebookId = createNotebook(db, 'Meu caderno')
    const first = getNotebook(db, notebookId).pages[0]
    const a = createNote(db, { lessonId: lesson('Ideia'), timestampSec: 5, body: 'limite' })
    sendNotesToNotebook(db, { noteIds: [a.id], notebookId, pageId: first.id })
    const v = createNote(db, { lessonId: lesson('Vetores'), timestampSec: 1, body: 'vetor' })
    sendNotesToNotebook(db, { noteIds: [a.id, v.id], notebookId, pageId: first.id })
    const blocks = getPage(db, first.id).blocks
    expect(blocks.map((x) => x.type)).toEqual(['resource', 'text', 'text', 'resource', 'text', 'text', 'resource', 'text'])
    expect(blocks.filter((x) => x.type === 'text').map((x) => (x.type === 'text' ? x.text.split(' ')[0] : ''))).toContain('##')
    expect(new Set(blocks.map((x) => x.id)).size).toBe(blocks.length)

    // Página nova num caderno existente
    const result = sendNotesToNotebook(db, { noteIds: [v.id], notebookId, pageId: null, pageTitle: 'Vetores' })
    expect(notebookPages(db, notebookId).map((p) => p.title)).toEqual(['Página 1', 'Vetores'])
    expect(result.pageId).not.toBe(first.id)
  })

  it('recusa pedidos inválidos', () => {
    const notebookId = createNotebook(db, 'A')
    const other = createNotebook(db, 'B')
    const a = createNote(db, { lessonId: lesson('Ideia'), timestampSec: 5, body: 'x' })
    expect(() => sendNotesToNotebook(db, { noteIds: [], notebookId: null, pageId: null })).toThrow('pelo menos uma')
    expect(() => sendNotesToNotebook(db, { noteIds: [999], notebookId: null, pageId: null })).toThrow('não encontradas')
    expect(() => sendNotesToNotebook(db, { noteIds: [a.id], notebookId, pageId: getNotebook(db, other).pages[0].id })).toThrow('não é deste caderno')
    expect(() => sendNotesToNotebook(db, { noteIds: [a.id], notebookId: 12345, pageId: null })).toThrow()
  })
})
