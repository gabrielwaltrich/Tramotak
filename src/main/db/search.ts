import { HL_END, HL_START, type SearchHit, type SearchKind } from '@shared/course'
import type { Database } from './database'

const KINDS: Record<number, SearchKind> = { 0: 'mindmap', 1: 'course', 2: 'module', 3: 'lesson', 4: 'note', 5: 'card', 6: 'question', 7: 'page' }
const MIN_QUERY_CHARS = 2
const DEFAULT_LIMIT = 60

/**
 * Converte o texto digitado numa consulta FTS5 segura: cada palavra vira um prefixo entre aspas
 * (`calc deriv` → `"calc"* "deriv"*`, todas obrigatórias). Pontuação e operadores são descartados.
 * `null` se sobrar menos de 2 caracteres úteis.
 */
export function buildFtsQuery(input: string): string | null {
  const words = input
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  if (words.join('').length < MIN_QUERY_CHARS) return null
  return words.map((w) => `"${w}"*`).join(' ')
}

interface RawHit {
  rowid: number
  title: string
  body: string | null
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(',')
}

/** Busca em cursos, módulos, aulas e anotações; ignora acentos e maiúsculas. */
export function search(db: Database, input: string, limit = DEFAULT_LIMIT): SearchHit[] {
  const query = buildFtsQuery(input)
  if (!query) return []

  const raw = db
    .prepare(
      `SELECT rowid,
              highlight(search_index, 0, ?, ?) AS title,
              snippet(search_index, 1, ?, ?, '…', 12) AS body
         FROM search_index
        WHERE search_index MATCH ?
        ORDER BY bm25(search_index, 4.0, 1.0)
        LIMIT ?`
    )
    .all(HL_START, HL_END, HL_START, HL_END, query, limit) as unknown as RawHit[]

  const ids: Record<SearchKind, number[]> = { course: [], module: [], lesson: [], note: [], card: [], question: [], page: [], mindmap: [] }
  for (const r of raw) ids[KINDS[r.rowid % 8]].push(Math.floor(r.rowid / 8))

  const byId = <T extends { id: number }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]))
  const fetch = <T extends { id: number }>(list: number[], sql: string): Map<number, T> =>
    list.length ? byId(db.prepare(sql.replace('$IDS', placeholders(list.length))).all(...list) as unknown as T[]) : new Map()

  const courses = fetch<{ id: number }>(ids.course, 'SELECT id FROM courses WHERE id IN ($IDS)')
  const modules = fetch<{ id: number; courseId: number; courseTitle: string; parentTitle: string | null }>(
    ids.module,
    `SELECT m.id, m.course_id AS courseId, c.title AS courseTitle, p.title AS parentTitle
       FROM modules m JOIN courses c ON c.id = m.course_id LEFT JOIN modules p ON p.id = m.parent_id
      WHERE m.id IN ($IDS)`
  )
  const lessons = fetch<{ id: number; kind: SearchHit['lessonKind']; courseId: number; courseTitle: string; moduleTitle: string | null }>(
    ids.lesson,
    `SELECT l.id, l.kind, l.course_id AS courseId, c.title AS courseTitle, m.title AS moduleTitle
       FROM lessons l JOIN courses c ON c.id = l.course_id LEFT JOIN modules m ON m.id = l.module_id
      WHERE l.id IN ($IDS)`
  )
  const notes = fetch<{
    id: number
    timestampSec: number | null
    lessonId: number
    lessonTitle: string
    lessonKind: SearchHit['lessonKind']
    courseId: number
    courseTitle: string
    moduleTitle: string | null
  }>(
    ids.note,
    `SELECT n.id, n.timestamp_sec AS timestampSec, l.id AS lessonId, l.title AS lessonTitle, l.kind AS lessonKind,
            l.course_id AS courseId, c.title AS courseTitle, m.title AS moduleTitle
       FROM notes n JOIN lessons l ON l.id = n.lesson_id JOIN courses c ON c.id = l.course_id
       LEFT JOIN modules m ON m.id = l.module_id
      WHERE n.id IN ($IDS)`
  )

  const cards = fetch<{ id: number; deckId: number; deckTitle: string; courseId: number | null; courseTitle: string | null }>(
    ids.card,
    `SELECT k.id, k.deck_id AS deckId, d.title AS deckTitle, l.course_id AS courseId, c.title AS courseTitle
       FROM cards k JOIN decks d ON d.id = k.deck_id
       LEFT JOIN lessons l ON l.id = k.lesson_id LEFT JOIN courses c ON c.id = l.course_id
      WHERE k.id IN ($IDS)`
  )

  const questions = fetch<{ id: number; bankId: number; bankTitle: string }>(
    ids.question,
    'SELECT q.id, q.bank_id AS bankId, b.title AS bankTitle FROM questions q JOIN question_banks b ON b.id = q.bank_id WHERE q.id IN ($IDS)'
  )

  const pages = fetch<{ id: number; notebookId: number; notebookTitle: string }>(
    ids.page,
    'SELECT p.id, p.notebook_id AS notebookId, n.title AS notebookTitle FROM notebook_pages p JOIN notebooks n ON n.id = p.notebook_id WHERE p.id IN ($IDS)'
  )
  const mindmaps = fetch<{ id: number }>(ids.mindmap, 'SELECT id FROM mindmaps WHERE id IN ($IDS)')

  const hits: SearchHit[] = []
  for (const r of raw) {
    const kind = KINDS[r.rowid % 8]
    const id = Math.floor(r.rowid / 8)
    const body = r.body && r.body.includes(HL_START) ? r.body : null
    const base = { kind, id, title: r.title, snippet: body, lessonId: null, lessonKind: null, timestampSec: null, moduleTitle: null, deckId: null, deckTitle: null, bankId: null, bankTitle: null, notebookId: null, notebookTitle: null }

    if (kind === 'course' && courses.has(id)) {
      hits.push({ ...base, courseId: id, courseTitle: r.title.replaceAll(HL_START, '').replaceAll(HL_END, '') })
    } else if (kind === 'module' && modules.has(id)) {
      const m = modules.get(id)!
      hits.push({ ...base, courseId: m.courseId, courseTitle: m.courseTitle, moduleTitle: m.parentTitle })
    } else if (kind === 'lesson' && lessons.has(id)) {
      const l = lessons.get(id)!
      hits.push({ ...base, courseId: l.courseId, courseTitle: l.courseTitle, moduleTitle: l.moduleTitle, lessonId: id, lessonKind: l.kind })
    } else if (kind === 'note' && notes.has(id)) {
      const n = notes.get(id)!
      hits.push({
        ...base,
        title: n.lessonTitle,
        snippet: r.body,
        courseId: n.courseId,
        courseTitle: n.courseTitle,
        moduleTitle: n.moduleTitle,
        lessonId: n.lessonId,
        lessonKind: n.lessonKind,
        timestampSec: n.timestampSec
      })
    } else if (kind === 'card' && cards.has(id)) {
      const k = cards.get(id)!
      hits.push({ ...base, courseId: k.courseId ?? 0, courseTitle: k.courseTitle ?? '', deckId: k.deckId, deckTitle: k.deckTitle })
    } else if (kind === 'question' && questions.has(id)) {
      const q = questions.get(id)!
      hits.push({ ...base, courseId: 0, courseTitle: '', bankId: q.bankId, bankTitle: q.bankTitle })
    } else if (kind === 'page' && pages.has(id)) {
      const p = pages.get(id)!
      hits.push({ ...base, courseId: 0, courseTitle: '', notebookId: p.notebookId, notebookTitle: p.notebookTitle })
    } else if (kind === 'mindmap' && mindmaps.has(id)) {
      hits.push({ ...base, courseId: 0, courseTitle: '' })
    }
  }
  return hits
}
