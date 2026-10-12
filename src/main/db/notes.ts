import { randomUUID } from 'node:crypto'
import type { Note } from '@shared/course'
import type { Block, Page } from '@shared/notebooks'
import { groupByLesson, noteMarkdown, suggestedPageTitle, type NoteEntry, type SendNotesRequest, type SendNotesResult } from '@shared/notes'
import { getCourseDetail, orderedLessons } from './courses'
import { transaction, type Database } from './database'
import { createNotebook, createPage, getNotebook, getPage, savePage } from './notebooks'

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

// ── Todas as anotações ──────────────────────────────────────────────────────

interface EntryRow extends Note {
  lessonTitle: string
  lessonKind: NoteEntry['lessonKind']
  courseId: number
  courseTitle: string
  moduleId: number | null
}

/**
 * Anotações de todos os cursos (ou de um), com aula, módulos e curso. Ordem: curso por nome, aulas na ordem de
 * estudo, notas pelo horário do vídeo.
 */
export function listAllNotes(db: Database, courseId: number | null = null): NoteEntry[] {
  const rows = db
    .prepare(
      `SELECT n.id, n.lesson_id AS lessonId, n.timestamp_sec AS timestampSec, n.body_md AS body, n.created_at AS createdAt,
              n.updated_at AS updatedAt, l.title AS lessonTitle, l.kind AS lessonKind, l.module_id AS moduleId,
              c.id AS courseId, c.title AS courseTitle
         FROM notes n JOIN lessons l ON l.id = n.lesson_id JOIN courses c ON c.id = l.course_id
        ${courseId !== null ? 'WHERE c.id = ?' : ''}`
    )
    .all(...(courseId !== null ? [courseId] : [])) as unknown as EntryRow[]
  if (rows.length === 0) return []

  const modules = new Map(
    (db.prepare('SELECT id, parent_id AS parentId, title FROM modules').all() as { id: number; parentId: number | null; title: string }[]).map(
      (m) => [m.id, m]
    )
  )
  const pathOf = (moduleId: number | null) => {
    const path: string[] = []
    for (let m = moduleId !== null ? modules.get(moduleId) : undefined; m; m = m.parentId !== null ? modules.get(m.parentId) : undefined) {
      path.unshift(m.title)
    }
    return path
  }
  const order = new Map<number, number>()
  for (const id of new Set(rows.map((r) => r.courseId))) {
    orderedLessons(getCourseDetail(db, id)).forEach((l, i) => order.set(l.id, i))
  }

  return rows
    .map(({ moduleId, ...r }) => ({ ...r, modulePath: pathOf(moduleId), lessonOrder: order.get(r.lessonId) ?? 0 }))
    .sort(
      (a, b) =>
        a.courseTitle.localeCompare(b.courseTitle, 'pt-BR') ||
        a.courseId - b.courseId ||
        a.lessonOrder - b.lessonOrder ||
        Number(a.timestampSec === null) - Number(b.timestampSec === null) ||
        (a.timestampSec ?? 0) - (b.timestampSec ?? 0) ||
        a.createdAt - b.createdAt ||
        a.id - b.id
    )
}

const MAX_SEND = 5000

/**
 * Leva anotações para um caderno: para cada aula, um bloco que abre a aula e um bloco de texto com as notas
 * (horários clicáveis, editáveis depois como qualquer texto). Cria o caderno e/ou a página se preciso; numa
 * página existente, entra no fim.
 */
export function sendNotesToNotebook(db: Database, request: SendNotesRequest): SendNotesResult {
  const ids = [...new Set((Array.isArray(request?.noteIds) ? request.noteIds : []).filter(Number.isInteger))].slice(0, MAX_SEND)
  if (ids.length === 0) throw new Error('Escolha pelo menos uma anotação')
  const wanted = new Set(ids)
  const entries = listAllNotes(db).filter((e) => wanted.has(e.id))
  if (entries.length === 0) throw new Error('Anotações não encontradas')

  return transaction(db, () => {
    const notebookId =
      request.notebookId !== null && request.notebookId !== undefined
        ? getNotebook(db, request.notebookId).id
        : createNotebook(db, request.notebookTitle?.trim() || suggestedPageTitle(entries))
    const fresh = request.notebookId === null || request.notebookId === undefined
    let page: Page
    if (request.pageId !== null && request.pageId !== undefined) {
      page = getPage(db, request.pageId)
      if (page.notebookId !== notebookId) throw new Error('A página não é deste caderno')
    } else if (fresh) {
      // Caderno novo já nasce com uma página em branco: usa ela.
      page = getPage(db, getNotebook(db, notebookId).pages[0].id)
    } else {
      page = createPage(db, notebookId, request.pageTitle?.trim() || suggestedPageTitle(entries))
    }
    const title = fresh ? request.pageTitle?.trim() || suggestedPageTitle(entries) : page.title

    // Página nova (só com o bloco vazio inicial) é substituída; numa existente, as notas entram no fim.
    const existing = page.blocks.filter((b) => !(b.type === 'text' && !b.text.trim()))
    // Único mesmo em envios seguidos no mesmo milissegundo (os blocos da página precisam de ids diferentes).
    const stamp = randomUUID().slice(0, 8)
    const blocks: Block[] = [...existing]
    const groups = groupByLesson(entries)
    const courses = new Set(groups.map((g) => g.courseId))
    let lastCourse: number | null = null
    groups.forEach((g, i) => {
      if (courses.size > 1 && g.courseId !== lastCourse) {
        blocks.push({ id: `n${stamp}c${i}`, type: 'text', text: `## ${g.courseTitle}` })
        lastCourse = g.courseId
      }
      blocks.push({ id: `n${stamp}r${i}`, type: 'resource', resource: { kind: 'lesson', id: g.lessonId, title: g.lessonTitle } })
      blocks.push({ id: `n${stamp}t${i}`, type: 'text', text: g.notes.map((n) => noteMarkdown(n)).join('\n') })
    })
    savePage(db, page.id, { title, blocks })
    return { notebookId, pageId: page.id, notes: entries.length }
  })
}
