import type { LessonKind, Note } from './course'
import { formatClock } from './format'
import { pageLink } from './pdf'

/** Anotação com o contexto da aula, para a página que reúne todas. */
export interface NoteEntry extends Note {
  lessonTitle: string
  lessonKind: LessonKind
  courseId: number
  courseTitle: string
  /** Módulos da aula, do mais externo ao mais interno. */
  modulePath: string[]
  /** Posição da aula na ordem de estudo do curso. */
  lessonOrder: number
}

export interface LessonNotes {
  lessonId: number
  lessonTitle: string
  courseId: number
  courseTitle: string
  modulePath: string[]
  notes: NoteEntry[]
}

/** Notas da mesma aula juntas, na ordem em que chegaram (a lista já vem ordenada). */
export function groupByLesson(entries: NoteEntry[]): LessonNotes[] {
  const groups: LessonNotes[] = []
  const index = new Map<number, LessonNotes>()
  for (const e of entries) {
    let group = index.get(e.lessonId)
    if (!group) {
      group = { lessonId: e.lessonId, lessonTitle: e.lessonTitle, courseId: e.courseId, courseTitle: e.courseTitle, modulePath: e.modulePath, notes: [] }
      index.set(e.lessonId, group)
      groups.push(group)
    }
    group.notes.push(e)
  }
  return groups
}

/** Link interno que abre a aula no ponto da anotação: horário do vídeo ou página do PDF (funciona nos cadernos). */
export function noteLink(lessonId: number, timestampSec: number | null, page: number | null = null, assetPath: string | null = null): string {
  if (page !== null) return pageLink(lessonId, page, assetPath)
  return timestampSec === null ? `#/lesson/${lessonId}` : `#/lesson/${lessonId}?t=${Math.floor(timestampSec)}`
}

/** "2:05", "p. 12" ou "apostila.pdf, p. 3": onde a nota foi feita. */
export function noteWhere(note: Pick<Note, 'timestampSec' | 'page' | 'assetPath'>): string {
  if (note.page !== null) return note.assetPath ? `${note.assetPath.split('/').pop()}, p. ${note.page}` : `p. ${note.page}`
  return note.timestampSec === null ? '' : formatClock(note.timestampSec)
}

/** Uma anotação como item de lista em Markdown, com o horário clicável. Linhas extras ficam dentro do item. */
export function noteMarkdown(note: Pick<Note, 'lessonId' | 'timestampSec' | 'body'> & Partial<Pick<Note, 'page' | 'assetPath'>>, links = true): string {
  const [first, ...rest] = note.body.split('\n')
  const where = { timestampSec: note.timestampSec, page: note.page ?? null, assetPath: note.assetPath ?? null }
  const time = noteWhere(where)
  const prefix = time ? (links ? `[**${time}**](${noteLink(note.lessonId, where.timestampSec, where.page, where.assetPath)}) ` : `**${time}** `) : ''
  return [`- ${prefix}${first}`, ...rest.map((line) => (line.trim() ? `  ${line}` : ''))].join('\n')
}

/**
 * Anotações agrupadas por aula em Markdown, para copiar ou salvar em arquivo. `links` gera horários clicáveis
 * (só fazem sentido dentro do Tramotak).
 */
export function notesToMarkdown(entries: NoteEntry[], links = false): string {
  const groups = groupByLesson(entries)
  const courses = new Set(groups.map((g) => g.courseId))
  const out: string[] = []
  let lastCourse: number | null = null
  for (const g of groups) {
    if (courses.size > 1 && g.courseId !== lastCourse) {
      out.push(`# ${g.courseTitle}`, '')
      lastCourse = g.courseId
    }
    out.push(`## ${[...g.modulePath, g.lessonTitle].join(' › ')}`, '')
    out.push(...g.notes.map((n) => noteMarkdown(n, links)), '')
  }
  return out.join('\n').trim() + '\n'
}

/** Título sugerido para a página do caderno que recebe as anotações. */
export function suggestedPageTitle(entries: NoteEntry[]): string {
  const lessons = new Set(entries.map((e) => e.lessonId))
  const courses = new Set(entries.map((e) => e.courseId))
  if (entries.length > 0 && lessons.size === 1) return entries[0].lessonTitle
  if (entries.length > 0 && courses.size === 1) return `Anotações · ${entries[0].courseTitle}`
  return 'Anotações'
}

export interface SendNotesRequest {
  noteIds: number[]
  /** Caderno existente, ou null para criar um com `notebookTitle`. */
  notebookId: number | null
  notebookTitle?: string
  /** Página existente (as anotações entram no fim), ou null para criar uma com `pageTitle`. */
  pageId: number | null
  pageTitle?: string
}

export interface SendNotesResult {
  notebookId: number
  pageId: number
  notes: number
}
