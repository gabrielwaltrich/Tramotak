import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { timestampedTranscript, type AiSource, type AiSourceRef, type AiSourceSection, type ChatMaterialInfo } from '@shared/ai'
import { pagePlainText } from '@shared/notebooks'
import { transcriptText } from '@shared/media'
import { formatClock } from '@shared/format'
import type { Database } from '../db/database'
import { assetFilePath, lessonOriginalPath } from '../db/lessons'
import { listNotes } from '../db/notes'
import { getTranscript } from '../db/media'
import { getPage } from '../db/notebooks'
import { htmlToText } from '../importers/html'

const MAX_FILE_BYTES = 2 * 1024 * 1024
const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.html', '.htm'])

/** Trechos de uma legenda SRT/VTT com o horário de início, sem tags nem linhas repetidas. */
export function subtitleToSegments(raw: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = []
  let start: number | null = null
  let last = ''
  for (const line of raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')) {
    const t = line.trim()
    const cue = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,]\d{1,3}\s*-->/.exec(t)
    if (cue) {
      start = Number(cue[1] ?? 0) * 3600 + Number(cue[2]) * 60 + Number(cue[3])
      continue
    }
    if (!t || start === null || /^WEBVTT/.test(t) || /^\d+$/.test(t) || /^(NOTE|STYLE|REGION)\b/.test(t)) continue
    const text = t.replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').trim()
    // Legendas automáticas repetem a linha anterior a cada quadro.
    if (text && text !== last) out.push({ start, text })
    last = text || last
  }
  return out
}

/** Só o texto falado de uma legenda SRT/VTT: sem numeração, horários, tags nem linhas repetidas. */
export function subtitleToText(raw: string): string {
  return subtitleToSegments(raw)
    .map((s) => s.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
async function readText(path: string): Promise<string | null> {
  const info = await stat(path).catch(() => null)
  if (!info || info.size > MAX_FILE_BYTES) return null
  const content = await readFile(path, 'utf8')
  const ext = extname(path).toLowerCase()
  return ext === '.html' || ext === '.htm' ? htmlToText(content) : content.replace(/^\uFEFF/, '')
}

async function lessonRow(db: Database, lessonId: number) {
  const lesson = db
    .prepare(
      `SELECT l.id, l.title, l.kind, l.course_id AS courseId, c.title AS courseTitle
         FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ?`
    )
    .get(lessonId) as { id: number; title: string; kind: string; courseId: number; courseTitle: string } | undefined
  if (!lesson) throw new Error('Aula não encontrada')
  return lesson
}

/** Primeira legenda que veio com o curso, em trechos com horário. */
async function subtitleSegments(db: Database, lessonId: number): Promise<{ start: number; text: string }[]> {
  const subtitles = db.prepare("SELECT id FROM lesson_assets WHERE lesson_id = ? AND kind = 'subtitle' ORDER BY lang IS NULL, id").all(lessonId) as { id: number }[]
  for (const s of subtitles) {
    const raw = await readText(assetFilePath(db, s.id)).catch(() => null)
    const segments = raw ? subtitleToSegments(raw) : []
    if (segments.length) return segments
  }
  return []
}

function notesText(db: Database, lessonId: number): { text: string; count: number } {
  const notes = listNotes(db, lessonId)
  return {
    text: notes.map((n) => (n.timestampSec !== null ? `[${formatClock(n.timestampSec)}] ${n.body}` : n.body)).join('\n'),
    count: notes.length
  }
}

async function lessonSource(db: Database, lessonId: number): Promise<AiSource> {
  const lesson = await lessonRow(db, lessonId)
  const sections: AiSourceSection[] = []

  if (lesson.kind === 'text') {
    const text = await readText(lessonOriginalPath(db, lessonId)).catch(() => null)
    if (text?.trim()) sections.push({ kind: 'lesson-text', label: 'Texto da aula', text, defaultOn: true })
  }

  const transcript = getTranscript(db, lessonId)
  if (transcript?.segments.length) {
    sections.push({ kind: 'transcript', label: 'Transcrição', text: transcriptText(transcript.segments), defaultOn: true })
  } else {
    // Sem transcrição, a legenda que veio com o curso faz o papel dela.
    const segments = await subtitleSegments(db, lessonId)
    if (segments.length) sections.push({ kind: 'subtitle', label: 'Legenda', text: segments.map((x) => x.text).join(' '), defaultOn: true })
  }

  // Anexos e anotações ficam desmarcados: a base padrão é só o que foi falado/escrito na aula.
  const attachments = db.prepare("SELECT id, rel_path AS relPath FROM lesson_assets WHERE lesson_id = ? AND kind = 'attachment' ORDER BY id").all(lessonId) as {
    id: number
    relPath: string
  }[]
  const supportTexts: string[] = []
  for (const a of attachments) {
    if (!TEXT_EXT.has(extname(a.relPath).toLowerCase())) continue
    const text = await readText(assetFilePath(db, a.id)).catch(() => null)
    if (text?.trim()) supportTexts.push(text.trim())
  }
  if (supportTexts.length) sections.push({ kind: 'attachments', label: 'Anexos de texto', text: supportTexts.join('\n\n'), defaultOn: false })

  const notes = notesText(db, lessonId)
  if (notes.count) sections.push({ kind: 'notes', label: 'Minhas anotações', text: notes.text, defaultOn: false })

  return { title: lesson.title, sections, lessonId: lesson.id, courseId: lesson.courseId }
}

/** Material da conversa: fala com marcas de tempo (transcrição ou legenda), texto da aula e, se pedido, as anotações. */
export async function chatMaterial(db: Database, lessonId: number, includeNotes: boolean): Promise<{ text: string; info: ChatMaterialInfo }> {
  const lesson = await lessonRow(db, lessonId)
  const parts: string[] = []
  let kind: ChatMaterialInfo['kind'] = null

  if (lesson.kind === 'text') {
    const text = await readText(lessonOriginalPath(db, lessonId)).catch(() => null)
    if (text?.trim()) {
      parts.push(`## Conteúdo escrito\n${text.trim()}`)
      kind = 'text'
    }
  }
  const transcript = getTranscript(db, lessonId)
  const segments = transcript?.segments.length ? transcript.segments : await subtitleSegments(db, lessonId)
  if (segments.length) {
    parts.push(`## ${transcript?.segments.length ? 'Transcrição automática da fala' : 'Legenda (texto falado)'}\n${timestampedTranscript(segments)}`)
    kind = transcript?.segments.length ? 'transcript' : 'subtitle'
  }
  const notes = notesText(db, lessonId)
  if (includeNotes && notes.count) parts.push(`## Anotações do estudante\n${notes.text}`)

  const text = parts.join('\n\n')
  return { text, info: { kind, chars: text.length, notes: notes.count } }
}

function pageSource(db: Database, pageId: number): AiSource {
  const page = getPage(db, pageId)
  const text = page.blocks
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n\n')
    .trim()
  const body = text || pagePlainText(page.blocks)
  return {
    title: page.title,
    sections: body.trim() ? [{ kind: 'page', label: 'Texto da página', text: body, defaultOn: true }] : [],
    lessonId: null,
    courseId: null
  }
}

export async function resolveSource(db: Database, ref: AiSourceRef): Promise<AiSource> {
  if (!ref || !Number.isInteger(ref.id)) throw new Error('Material inválido')
  if (ref.kind === 'lesson') return lessonSource(db, ref.id)
  if (ref.kind === 'page') return pageSource(db, ref.id)
  throw new Error('Material inválido')
}
