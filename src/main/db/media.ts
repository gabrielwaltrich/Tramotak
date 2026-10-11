import { transcriptText, type Transcript, type TranscriptionProvider, type TranscriptSegment } from '@shared/media'
import type { Database } from './database'

export function getConversion(db: Database, lessonId: number): { file: string; at: number } | null {
  const row = db.prepare('SELECT converted_file AS file, converted_at AS at FROM lessons WHERE id = ?').get(lessonId) as
    | { file: string | null; at: number | null }
    | undefined
  return row?.file ? { file: row.file, at: row.at ?? 0 } : null
}

export function setConversion(db: Database, lessonId: number, file: string | null, now = Math.floor(Date.now() / 1000)): void {
  db.prepare('UPDATE lessons SET converted_file = ?, converted_at = ? WHERE id = ?').run(file, file ? now : null, lessonId)
}

/** Arquivos de conversão ainda usados por alguma aula (o resto pode ser apagado). */
export function usedConversions(db: Database): Set<string> {
  return new Set((db.prepare('SELECT converted_file AS f FROM lessons WHERE converted_file IS NOT NULL').all() as { f: string }[]).map((r) => r.f))
}

export function saveTranscript(
  db: Database,
  lessonId: number,
  input: { provider: TranscriptionProvider; model: string; language: string; segments: TranscriptSegment[] },
  now = Math.floor(Date.now() / 1000)
): void {
  db.prepare(
    `INSERT INTO transcripts (lesson_id, provider, model, language, segments_json, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (lesson_id) DO UPDATE SET provider = excluded.provider, model = excluded.model, language = excluded.language,
       segments_json = excluded.segments_json, text = excluded.text, created_at = excluded.created_at`
  ).run(lessonId, input.provider, input.model, input.language, JSON.stringify(input.segments), transcriptText(input.segments), now)
}

export function getTranscript(db: Database, lessonId: number): Transcript | null {
  const row = db
    .prepare('SELECT lesson_id AS lessonId, provider, model, language, segments_json AS segments, created_at AS createdAt FROM transcripts WHERE lesson_id = ?')
    .get(lessonId) as (Omit<Transcript, 'segments'> & { segments: string }) | undefined
  return row ? { ...row, segments: JSON.parse(row.segments) } : null
}

export function deleteTranscript(db: Database, lessonId: number): void {
  db.prepare('DELETE FROM transcripts WHERE lesson_id = ?').run(lessonId)
}

/** Aulas de vídeo de um curso, para verificar formatos em lote. */
export function courseVideoLessons(db: Database, courseId: number): { id: number; title: string; convertedFile: string | null }[] {
  return db
    .prepare("SELECT id, title, converted_file AS convertedFile FROM lessons WHERE course_id = ? AND kind = 'video' ORDER BY id")
    .all(courseId) as { id: number; title: string; convertedFile: string | null }[]
}
