import { stat } from 'node:fs/promises'
import { chunkPages, chunkSegments, chunkText, type Chunk, type FoundChunk } from '@shared/courseChat'
import { isPdfPath } from '@shared/pdf'
import { transaction, type Database } from '../db/database'
import { getCourseDetail, orderedLessons } from '../db/courses'
import { assetFilePath, lessonOriginalPath } from '../db/lessons'
import { pdfPagesText } from '../pdf/text'
import { readText, subtitleToSegments } from './source'

type Material = { kind: 'transcript' | 'subtitle' | 'text' | 'pdf'; version: string; load: () => Promise<Chunk[]> }

/** De onde vem o texto de uma aula (a transcrição tem prioridade sobre a legenda), com a "versão" para saber se mudou. */
async function lessonMaterial(db: Database, lesson: { id: number; kind: string; relPath: string }): Promise<Material | null> {
  const transcript = db.prepare('SELECT created_at AS at, segments_json AS segments FROM transcripts WHERE lesson_id = ?').get(lesson.id) as
    | { at: number; segments: string }
    | undefined
  if (transcript) {
    return {
      kind: 'transcript',
      version: `t:${transcript.at}`,
      load: async () => chunkSegments(JSON.parse(transcript.segments) as { start: number; text: string }[])
    }
  }
  if (lesson.kind === 'video') {
    const subtitle = db.prepare("SELECT id FROM lesson_assets WHERE lesson_id = ? AND kind = 'subtitle' ORDER BY lang IS NULL, id LIMIT 1").get(lesson.id) as
      | { id: number }
      | undefined
    if (!subtitle) return null
    const path = assetFilePath(db, subtitle.id)
    const info = await stat(path).catch(() => null)
    if (!info) return null
    return { kind: 'subtitle', version: `s:${info.size}:${info.mtimeMs}`, load: async () => chunkSegments(subtitleToSegments((await readText(path)) ?? '')) }
  }
  const path = lessonOriginalPath(db, lesson.id)
  const info = await stat(path).catch(() => null)
  if (!info) return null
  const version = `${info.size}:${info.mtimeMs}`
  if (lesson.kind === 'text') return { kind: 'text', version: `x:${version}`, load: async () => chunkText((await readText(path)) ?? '') }
  if (lesson.kind === 'document' && isPdfPath(lesson.relPath)) return { kind: 'pdf', version: `p:${version}`, load: async () => chunkPages(await pdfPagesText(path)) }
  return null
}

/**
 * Deixa os trechos do curso em dia: refaz só as aulas cujo material mudou (transcrição nova, arquivo alterado) e tira
 * as que perderam o material. Devolve quantas aulas têm material.
 */
export async function syncCourseChunks(db: Database, courseId: number): Promise<{ withMaterial: number; total: number }> {
  const lessons = orderedLessons(getCourseDetail(db, courseId))
  const known = new Map(
    (
      db
        .prepare('SELECT s.lesson_id AS lessonId, s.version FROM chunk_sources s JOIN lessons l ON l.id = s.lesson_id WHERE l.course_id = ?')
        .all(courseId) as { lessonId: number; version: string }[]
    ).map((r) => [r.lessonId, r.version])
  )
  const insert = db.prepare('INSERT INTO course_chunks (text, lesson_id, start_sec, page) VALUES (?, ?, ?, ?)')
  let withMaterial = 0
  for (const lesson of lessons) {
    const material = await lessonMaterial(db, lesson).catch(() => null)
    if (!material) {
      if (known.has(lesson.id)) db.prepare('DELETE FROM chunk_sources WHERE lesson_id = ?').run(lesson.id)
      continue
    }
    if (known.get(lesson.id) === material.version) {
      withMaterial++
      continue
    }
    const chunks = await material.load().catch(() => [] as Chunk[])
    transaction(db, () => {
      // Apagar a origem apaga os trechos antigos (gatilho); a origem nova volta junto com os trechos.
      db.prepare('DELETE FROM chunk_sources WHERE lesson_id = ?').run(lesson.id)
      if (!chunks.length) return
      db.prepare('INSERT INTO chunk_sources (lesson_id, kind, version) VALUES (?, ?, ?)').run(lesson.id, material.kind, material.version)
      for (const c of chunks) insert.run(c.text, lesson.id, c.startSec, c.page)
    })
    if (chunks.length) withMaterial++
  }
  return { withMaterial, total: lessons.length }
}

/** Quantas aulas do curso já têm trechos (sem refazer nada; para mostrar antes da primeira pergunta). */
export function indexedLessons(db: Database, courseId: number): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM chunk_sources s JOIN lessons l ON l.id = s.lesson_id WHERE l.course_id = ?').get(courseId) as { n: number }).n
}

/**
 * Trechos do curso que casam com a consulta, dos mais relevantes aos menos, até `maxChars`. Cada aula tem a posição
 * no curso (o código "A9" da conversa).
 */
export function searchCourseChunks(db: Database, courseId: number, query: string, maxChars: number, limit = 120): FoundChunk[] {
  const order = new Map(orderedLessons(getCourseDetail(db, courseId)).map((l, i) => [l.id, i + 1]))
  const rows = db
    .prepare(
      `SELECT text, lesson_id AS lessonId, start_sec AS startSec, page FROM course_chunks
        WHERE course_chunks MATCH ? AND lesson_id IN (SELECT id FROM lessons WHERE course_id = ?)
        ORDER BY bm25(course_chunks) LIMIT ?`
    )
    .all(query, courseId, limit) as { text: string; lessonId: number; startSec: number | null; page: number | null }[]
  const out: FoundChunk[] = []
  let used = 0
  for (const r of rows) {
    if (used + r.text.length > maxChars) break
    const position = order.get(r.lessonId)
    if (position === undefined) continue
    used += r.text.length + 20
    out.push({ ...r, order: position })
  }
  return out
}
