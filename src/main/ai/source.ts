import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import type { AiSource, AiSourceRef } from '@shared/ai'
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

/** Só o texto falado de uma legenda SRT/VTT: sem numeração, horários, tags nem linhas repetidas. */
export function subtitleToText(raw: string): string {
  const lines: string[] = []
  for (const line of raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')) {
    const t = line.trim()
    if (!t || /^WEBVTT/.test(t) || /^\d+$/.test(t) || /-->/.test(t) || /^(NOTE|STYLE|REGION)\b/.test(t)) continue
    const text = t.replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').trim()
    // Legendas automáticas repetem a linha anterior a cada quadro.
    if (text && text !== lines[lines.length - 1]) lines.push(text)
  }
  return lines.join(' ').replace(/\s+/g, ' ').trim()
}

async function readText(path: string): Promise<string | null> {
  const info = await stat(path).catch(() => null)
  if (!info || info.size > MAX_FILE_BYTES) return null
  const content = await readFile(path, 'utf8')
  const ext = extname(path).toLowerCase()
  return ext === '.html' || ext === '.htm' ? htmlToText(content) : content.replace(/^\uFEFF/, '')
}

async function lessonSource(db: Database, lessonId: number): Promise<AiSource> {
  const lesson = db
    .prepare(
      `SELECT l.id, l.title, l.kind, l.course_id AS courseId, c.title AS courseTitle, m.title AS moduleTitle
         FROM lessons l JOIN courses c ON c.id = l.course_id LEFT JOIN modules m ON m.id = l.module_id WHERE l.id = ?`
    )
    .get(lessonId) as { id: number; title: string; kind: string; courseId: number; courseTitle: string; moduleTitle: string | null } | undefined
  if (!lesson) throw new Error('Aula não encontrada')

  const sections: { label: string; text: string }[] = []

  if (lesson.kind === 'text') {
    const text = await readText(lessonOriginalPath(db, lessonId)).catch(() => null)
    if (text?.trim()) sections.push({ label: 'Texto da aula', text })
  }

  const transcript = getTranscript(db, lessonId)
  if (transcript?.segments.length) {
    sections.push({ label: 'Transcrição', text: transcriptText(transcript.segments) })
  } else {
    // Sem transcrição, a legenda que veio com o curso faz o papel dela (a primeira encontrada).
    const subtitles = db.prepare("SELECT id FROM lesson_assets WHERE lesson_id = ? AND kind = 'subtitle' ORDER BY lang IS NULL, id").all(lessonId) as { id: number }[]
    for (const s of subtitles) {
      const raw = await readText(assetFilePath(db, s.id)).catch(() => null)
      const text = raw ? subtitleToText(raw) : ''
      if (text) {
        sections.push({ label: 'Legenda', text })
        break
      }
    }
  }

  const attachments = db.prepare("SELECT id, rel_path AS relPath FROM lesson_assets WHERE lesson_id = ? AND kind = 'attachment' ORDER BY id").all(lessonId) as {
    id: number
    relPath: string
  }[]
  for (const a of attachments) {
    if (!TEXT_EXT.has(extname(a.relPath).toLowerCase())) continue
    const text = await readText(assetFilePath(db, a.id)).catch(() => null)
    if (text?.trim()) sections.push({ label: `Anexo: ${a.relPath.split('/').pop()}`, text })
  }

  const notes = listNotes(db, lessonId)
  if (notes.length) {
    sections.push({
      label: 'Minhas anotações',
      text: notes.map((n) => (n.timestampSec !== null ? `[${formatClock(n.timestampSec)}] ${n.body}` : n.body)).join('\n')
    })
  }

  const context = [lesson.courseTitle, lesson.moduleTitle].filter(Boolean).join(' › ')
  return {
    title: context ? `${lesson.title} (${context})` : lesson.title,
    text: sections.map((s) => `## ${s.label}\n${s.text.trim()}`).join('\n\n'),
    parts: sections.map((s) => ({ label: s.label, chars: s.text.trim().length })),
    lessonId: lesson.id,
    courseId: lesson.courseId
  }
}

function pageSource(db: Database, pageId: number): AiSource {
  const page = getPage(db, pageId)
  const text = page.blocks
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n\n')
    .trim()
  return {
    title: page.title,
    text: text || pagePlainText(page.blocks),
    parts: text ? [{ label: 'Texto da página', chars: text.length }] : [],
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
