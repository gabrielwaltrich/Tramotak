import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Database } from '../../src/main/db/database'
import { insertScannedCourse } from '../../src/main/db/courses'
import { createNote } from '../../src/main/db/notes'
import { saveTranscript } from '../../src/main/db/media'
import { createNotebook, createPage, savePage } from '../../src/main/db/notebooks'
import { scanCourse } from '../../src/main/scanner/scan'
import { resolveSource } from '../../src/main/ai/source'
import { makeCourse } from '../helpers/fixture'

let db: Database
let course: Awaited<ReturnType<typeof makeCourse>>
const lessonId = (title: string) => (db.prepare('SELECT id FROM lessons WHERE title LIKE ?').get(`%${title}%`) as { id: number }).id

beforeEach(async () => {
  course = await makeCourse(['01 Módulo/01 Limites.mp4', '01 Módulo/01 Limites.srt', '01 Módulo/02 Derivadas.mp4', '01 Módulo/03 Resumo.md', '01 Módulo/apostila.txt'])
  await writeFile(join(course.root, '01 Módulo', '01 Limites.srt'), '1\n00:00:01,000 --> 00:00:02,000\nLimite é aproximação\n')
  await writeFile(join(course.root, '01 Módulo', '03 Resumo.md'), '# Resumo\nTexto do resumo')
  db = openDatabase(':memory:')
  const scan = await scanCourse(course.root, { structure: 'auto', numbering: 'dot' })
  insertScannedCourse(db, { title: 'Cálculo', rootPath: course.root, numbering: 'dot', scanStructure: 'auto' }, scan)
})

afterEach(async () => {
  db.close()
  await course.cleanup()
})

describe('material para a IA', () => {
  it('sem transcrição, usa a legenda do curso; inclui anotações com horário', async () => {
    const id = lessonId('Limites')
    createNote(db, { lessonId: id, timestampSec: 75, body: 'cuidado com 0/0' })
    const source = await resolveSource(db, { kind: 'lesson', id })
    expect(source.title).toContain('Limites')
    expect(source.title).toContain('Cálculo')
    expect(source.parts.map((p) => p.label)).toEqual(['Legenda', 'Minhas anotações'])
    expect(source.text).toContain('Limite é aproximação')
    expect(source.text).toContain('[1:15] cuidado com 0/0')
    expect(source.lessonId).toBe(id)
  })

  it('a transcrição tem prioridade sobre a legenda', async () => {
    const id = lessonId('Limites')
    saveTranscript(db, id, { provider: 'groq', model: 'w', language: 'pt', segments: [{ start: 0, end: 2, text: 'fala transcrita' }] })
    const source = await resolveSource(db, { kind: 'lesson', id })
    expect(source.parts.map((p) => p.label)).toEqual(['Transcrição'])
    expect(source.text).not.toContain('aproximação')
  })

  it('aula de texto entra pelo conteúdo do arquivo; aula sem material fica vazia', async () => {
    expect((await resolveSource(db, { kind: 'lesson', id: lessonId('Resumo') })).text).toContain('Texto do resumo')
    const empty = await resolveSource(db, { kind: 'lesson', id: lessonId('Derivadas') })
    expect(empty.parts).toEqual([])
  })

  it('página de caderno usa os blocos de texto', async () => {
    const page = createPage(db, createNotebook(db, 'Caderno'))
    savePage(db, page.id, { title: 'Integrais', blocks: [{ id: 'a', type: 'text', text: 'Integral é área' }, { id: 'b', type: 'ink', strokes: [], height: 200 }] })
    const source = await resolveSource(db, { kind: 'page', id: page.id })
    expect(source).toMatchObject({ title: 'Integrais', text: 'Integral é área', lessonId: null })
  })

  it('recusa referência inválida', async () => {
    await expect(resolveSource(db, { kind: 'x', id: 1 } as never)).rejects.toThrow(/inválido/)
    await expect(resolveSource(db, { kind: 'lesson', id: 999 })).rejects.toThrow(/não encontrada/)
  })
})
