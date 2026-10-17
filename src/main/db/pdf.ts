import { isHighlightColor, isPdfPath, MAX_HIGHLIGHT_TEXT, mergeRects, normalizeRects, type HighlightColor, type NewHighlight, type PdfHighlight } from '@shared/pdf'
import type { Database } from './database'

interface Row {
  id: number
  lessonId: number
  assetPath: string | null
  page: number
  rects: string
  text: string
  color: string
  createdAt: number
}

const COLUMNS = 'id, lesson_id AS lessonId, asset_path AS assetPath, page, rects_json AS rects, text, color, created_at AS createdAt'

function toHighlight(row: Row): PdfHighlight {
  let rects: unknown = []
  try {
    rects = JSON.parse(row.rects)
  } catch {
    // retângulos corrompidos: o grifo fica sem área, mas o texto continua
  }
  return { ...row, rects: normalizeRects(rects), color: (isHighlightColor(row.color) ? row.color : 'yellow') as HighlightColor }
}

/**
 * Confere que o PDF existe: a própria aula (precisa ser .pdf) ou um anexo PDF dela, pelo caminho dentro do curso.
 * Devolve o caminho normalizado (ou `null` para a aula).
 */
export function assertPdf(db: Database, lessonId: number, assetPath: unknown): string | null {
  const lesson = db.prepare('SELECT rel_path AS relPath FROM lessons WHERE id = ?').get(lessonId) as { relPath: string } | undefined
  if (!lesson) throw new Error('Aula não encontrada')
  if (assetPath === null || assetPath === undefined) {
    if (!isPdfPath(lesson.relPath)) throw new Error('Esta aula não é um PDF')
    return null
  }
  if (typeof assetPath !== 'string') throw new Error('Anexo inválido')
  const asset = db.prepare("SELECT 1 FROM lesson_assets WHERE lesson_id = ? AND kind = 'attachment' AND rel_path = ?").get(lessonId, assetPath)
  if (!asset || !isPdfPath(assetPath)) throw new Error('Anexo PDF não encontrado')
  return assetPath
}

export function listHighlights(db: Database, lessonId: number, assetPath: string | null): PdfHighlight[] {
  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM pdf_highlights WHERE lesson_id = ? AND asset_path IS ? ORDER BY page, id`)
    .all(lessonId, assetPath) as unknown as Row[]
  return rows.map(toHighlight)
}

export function createHighlight(db: Database, input: NewHighlight, now = Math.floor(Date.now() / 1000)): PdfHighlight {
  const assetPath = assertPdf(db, input.lessonId, input.assetPath)
  const page = Number(input.page)
  if (!Number.isInteger(page) || page < 1 || page > 100_000) throw new Error('Página inválida')
  const rects = mergeRects(normalizeRects(input.rects))
  if (!rects.length) throw new Error('Selecione um trecho do texto para grifar')
  if (!isHighlightColor(input.color)) throw new Error('Cor inválida')
  const text = String(input.text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_HIGHLIGHT_TEXT)
  const { lastInsertRowid } = db
    .prepare('INSERT INTO pdf_highlights (lesson_id, asset_path, page, rects_json, text, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(input.lessonId, assetPath, page, JSON.stringify(rects), text, input.color, now)
  return toHighlight(db.prepare(`SELECT ${COLUMNS} FROM pdf_highlights WHERE id = ?`).get(Number(lastInsertRowid)) as unknown as Row)
}

export function setHighlightColor(db: Database, id: number, color: unknown): void {
  if (!isHighlightColor(color)) throw new Error('Cor inválida')
  db.prepare('UPDATE pdf_highlights SET color = ? WHERE id = ?').run(color, id)
}

export function deleteHighlight(db: Database, id: number): void {
  db.prepare('DELETE FROM pdf_highlights WHERE id = ?').run(id)
}
