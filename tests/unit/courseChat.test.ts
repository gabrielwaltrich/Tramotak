import { utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildCourseChatSystem,
  buildTermsPrompt,
  chunkPages,
  chunkSegments,
  chunkText,
  composeCourseMaterial,
  COURSE_REF,
  courseRefLink,
  ftsQueryFromTerms,
  keywords,
  parseCourseRef,
  parseSearchTerms
} from '../../src/shared/courseChat'
import { openDatabase, type Database } from '../../src/main/db/database'
import { insertScannedCourse } from '../../src/main/db/courses'
import { deleteTranscript, saveTranscript } from '../../src/main/db/media'
import { appendCourseChat, clearCourseChat, getCourseChat } from '../../src/main/db/courseChats'
import { indexedLessons, searchCourseChunks, syncCourseChunks } from '../../src/main/ai/courseIndex'
import { scanCourse } from '../../src/main/scanner/scan'
import { makeCourse } from '../helpers/fixture'
import { makePdf } from '../helpers/pdf'

describe('conversa sobre o curso: regras puras', () => {
  it('divide a fala em trechos com o horário de início', () => {
    const segments = Array.from({ length: 30 }, (_, i) => ({ start: i * 10, text: `frase número ${i} sobre containers e imagens do docker` }))
    const chunks = chunkSegments(segments, 300)
    expect(chunks.length).toBeGreaterThan(3)
    expect(chunks[0]).toMatchObject({ startSec: 0, page: null })
    expect(chunks[1].startSec).toBeGreaterThan(0)
    expect(chunks.map((c) => c.text).join(' ')).toContain('frase número 29')
    expect(chunkSegments([{ start: 3.7, text: '  ' }, { start: 5.2, text: 'só isso' }])).toEqual([{ text: 'só isso', startSec: 5, page: null }])
  })

  it('texto e páginas viram trechos de tamanho limitado, cortando em fim de frase', () => {
    const long = Array.from({ length: 150 }, (_, i) => `Frase ${i} sobre redes.`).join(' ')
    const chunks = chunkText(long)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((c) => c.text.length <= 1600 && c.text.endsWith('.'))).toBe(true)
    expect(chunkPages(['primeira', '', 'terceira'])).toEqual([
      { text: 'primeira', startSec: null, page: 1 },
      { text: 'terceira', startSec: null, page: 3 }
    ])
  })

  it('termos de busca: palavras úteis, frases, prefixos e nada de operadores', () => {
    expect(keywords('Como o curso explica o isolamento de processos no Linux?')).toEqual(['isolamento', 'processos', 'linux'])
    expect(ftsQueryFromTerms(['Namespaces', 'control groups', 'aula', 'linux', 'Linux', 'x', 'NOT "AND" OR'])).toBe('"namespaces"* OR "control groups" OR "linux"* OR "not and or"')
    expect(ftsQueryFromTerms(['de', 'a'])).toBeNull()
    expect(parseSearchTerms({ terms: ['kernel', 3, ' cgroups '] })).toEqual(['kernel', 'cgroups'])
    expect(parseSearchTerms(['x'])).toEqual(['x'])
    expect(parseSearchTerms('nada')).toEqual([])
    expect(buildTermsPrompt('E o isso?', ['O que é kernel?']).user).toContain('- O que é kernel?')
  })

  it('material agrupado por aula (só o código), citações e links', () => {
    const { text, refs } = composeCourseMaterial([
      { lessonId: 40, order: 9, text: 'segundo trecho', startSec: 754, page: null },
      { lessonId: 12, order: 2, text: 'apostila', startSec: null, page: 3 },
      { lessonId: 40, order: 9, text: 'primeiro trecho', startSec: 5, page: null }
    ])
    expect(text).toBe('### A2\n[A2 p. 3] apostila\n\n### A9\n[A9 0:05] primeiro trecho\n[A9 12:34] segundo trecho')
    expect(refs).toEqual({ A2: 12, A9: 40 })

    const found = [...'Veja [A9 12:34], [A2 p. 3], [A7 · 1:02:03] e [A4].'.matchAll(COURSE_REF)].map(parseCourseRef)
    expect(found).toEqual([
      { code: 'A9', sec: 754, page: null },
      { code: 'A2', sec: null, page: 3 },
      { code: 'A7', sec: 3723, page: null },
      { code: 'A4', sec: null, page: null }
    ])
    expect(courseRefLink(40, found[0])).toBe('#/lesson/40?t=754')
    expect(courseRefLink(12, found[1])).toBe('#/lesson/12?p=3')

    const system = buildCourseChatSystem(text, { web: false, found: true })
    expect(system).toContain('[A9 12:34] segundo trecho')
    expect(system).toContain('Não invente títulos de aulas')
    expect(buildCourseChatSystem('', { web: false, found: false })).toContain('A busca não encontrou trechos')
  })
})

describe('conversa sobre o curso: índice de trechos e conversas', () => {
  let db: Database
  let course: Awaited<ReturnType<typeof makeCourse>>
  let courseId: number
  const lessonId = (title: string) => (db.prepare('SELECT id FROM lessons WHERE title LIKE ?').get(`%${title}%`) as { id: number }).id

  beforeEach(async () => {
    course = await makeCourse(['01 Mod/01 Kernel.mp4', '01 Mod/02 Containers.mp4', '01 Mod/02 Containers.srt', '01 Mod/03 Resumo.md', '01 Mod/04 Apostila.pdf', '01 Mod/05 Sem nada.mp4'])
    await writeFile(join(course.root, '01 Mod', '02 Containers.srt'), '1\n00:01:00,000 --> 00:01:04,000\nContainers compartilham o kernel do hospedeiro\n')
    await writeFile(join(course.root, '01 Mod', '03 Resumo.md'), '# Resumo\nNamespaces isolam processos e cgroups limitam recursos.')
    await writeFile(join(course.root, '01 Mod', '04 Apostila.pdf'), makePdf([['Capa'], ['Imagens Docker sao feitas de camadas.']]))
    db = openDatabase(':memory:')
    courseId = insertScannedCourse(db, { title: 'DevOps', rootPath: course.root, numbering: 'dot', scanStructure: 'auto' }, await scanCourse(course.root, { structure: 'auto', numbering: 'dot' }))
    saveTranscript(db, lessonId('Kernel'), { provider: 'groq', model: 'w', language: 'pt', segments: [{ start: 125, end: 130, text: 'O kernel do Linux gerencia memória e processos.' }] }, 100)
  })

  afterEach(async () => {
    db.close()
    await course.cleanup()
  })

  it('junta transcrição, legenda, texto e PDF; refaz só o que mudou', async () => {
    expect(await syncCourseChunks(db, courseId)).toEqual({ withMaterial: 4, total: 5 })
    expect(indexedLessons(db, courseId)).toBe(4)
    const all = (q: string) => searchCourseChunks(db, courseId, q, 10_000).map((c) => [c.order, c.startSec, c.page])
    expect(all('"kernel"*')).toEqual(expect.arrayContaining([[1, 125, null], [2, 60, null]]))
    expect(all('"cgroups"*')).toEqual([[3, null, null]])
    expect(all('"camadas"*')).toEqual([[4, null, 2]])

    const count = () => (db.prepare('SELECT COUNT(*) AS n FROM course_chunks').get() as { n: number }).n
    const before = count()
    await syncCourseChunks(db, courseId)
    expect(count()).toBe(before)

    // Transcrição nova substitui a anterior; apagada, a aula sai do índice
    saveTranscript(db, lessonId('Kernel'), { provider: 'groq', model: 'w', language: 'pt', segments: [{ start: 3, end: 6, text: 'Agora o assunto é o escalonador.' }] }, 200)
    await syncCourseChunks(db, courseId)
    expect(all('"escalonador"*')).toEqual([[1, 3, null]])
    expect(all('"memoria"*')).toEqual([])
    deleteTranscript(db, lessonId('Kernel'))
    expect(await syncCourseChunks(db, courseId)).toMatchObject({ withMaterial: 3 })
    expect(all('"escalonador"*')).toEqual([])

    // Arquivo alterado: refaz a aula de texto
    await writeFile(join(course.root, '01 Mod', '03 Resumo.md'), 'Agora fala de systemd.')
    await utimes(join(course.root, '01 Mod', '03 Resumo.md'), new Date(), new Date(Date.now() + 5000))
    await syncCourseChunks(db, courseId)
    expect(all('"systemd"*')).toEqual([[3, null, null]])
  })

  it('a busca respeita o limite de caracteres, só olha o curso pedido e some com a aula', async () => {
    await syncCourseChunks(db, courseId)
    expect(searchCourseChunks(db, courseId, '"kernel"*', 10)).toEqual([])
    const other = Number(db.prepare("INSERT INTO courses (title, root_path, structure, numbering) VALUES ('Outro', '/outro', 'flat', 'dot')").run().lastInsertRowid)
    expect(searchCourseChunks(db, other, '"kernel"*', 10_000)).toEqual([])
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId('Containers'))
    expect(searchCourseChunks(db, courseId, '"hospedeiro"*', 10_000)).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS n FROM course_chunks WHERE lesson_id = ?').get(lessonId('Resumo'))).toEqual({ n: 1 })
  })

  it('conversas por curso: guardam referências, limpam e somem com o curso', () => {
    appendCourseChat(db, courseId, [
      { role: 'user', content: 'o que é kernel?', at: 1 },
      { role: 'assistant', content: 'Veja [A1 2:05].', at: 2, refs: { A1: lessonId('Kernel') }, consulted: { chunks: 1, lessons: 1, terms: ['kernel'] } }
    ])
    expect(getCourseChat(db, courseId)[1]).toMatchObject({ refs: { A1: lessonId('Kernel') }, consulted: { chunks: 1 } })
    clearCourseChat(db, courseId)
    expect(getCourseChat(db, courseId)).toEqual([])
    appendCourseChat(db, courseId, [{ role: 'user', content: 'x', at: 1 }])
    db.prepare('DELETE FROM courses WHERE id = ?').run(courseId)
    expect(getCourseChat(db, courseId)).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS n FROM course_chunks').get()).toEqual({ n: 0 })
  })
})
