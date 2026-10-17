import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildChatSystem, chatHistory } from '../../src/shared/ai'
import { noteLink, noteMarkdown, noteWhere } from '../../src/shared/notes'
import { cleanPageText, mergeRects, normalizeRects, PAGE_REF, pageLink, pdfPlainText, pdfTextWithPages } from '../../src/shared/pdf'
import { parsePdfjsUrl } from '../../src/shared/media'
import { openDatabase, type Database } from '../../src/main/db/database'
import { insertScannedCourse, revalidateCourse } from '../../src/main/db/courses'
import { createNote, listAllNotes, listNotes } from '../../src/main/db/notes'
import { assertPdf, createHighlight, deleteHighlight, listHighlights, setHighlightColor } from '../../src/main/db/pdf'
import { getLessonView, saveProgress } from '../../src/main/db/lessons'
import { chatMaterial, resolveSource, reviewMaterial } from '../../src/main/ai/source'
import { pdfPagesText } from '../../src/main/pdf/text'
import { scanCourse } from '../../src/main/scanner/scan'
import { makeCourse } from '../helpers/fixture'
import { makePdf } from '../helpers/pdf'

describe('PDF: regras puras', () => {
  it('retângulos: descarta inválidos, prende na página e junta os da mesma linha', () => {
    expect(normalizeRects('x')).toEqual([])
    expect(normalizeRects([{ x: 0.1, y: 0.2, w: 0.3, h: 0.02 }, { x: NaN, y: 0, w: 1, h: 1 }, { x: 0.9, y: 0.5, w: 0.5, h: 0.1 }, { x: 0, y: 0, w: 0, h: 0.1 }])).toEqual([
      { x: 0.1, y: 0.2, w: expect.closeTo(0.3, 9), h: expect.closeTo(0.02, 9) },
      { x: 0.9, y: 0.5, w: expect.closeTo(0.1, 9), h: expect.closeTo(0.1, 9) }
    ])
    const merged = mergeRects([
      { x: 0.1, y: 0.2, w: 0.2, h: 0.02 },
      { x: 0.29, y: 0.201, w: 0.2, h: 0.02 },
      { x: 0.1, y: 0.25, w: 0.3, h: 0.02 }
    ])
    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({ x: 0.1, y: 0.2 })
    expect(merged[0].w).toBeCloseTo(0.39, 5)
  })

  it('texto da página: junta trechos, tira hifenização de fim de linha e marca as páginas', () => {
    expect(cleanPageText([{ str: 'O ker-', hasEOL: true }, { str: 'nel   gerencia' }, { str: ' processos.', hasEOL: true }])).toBe('O kernel gerencia processos.')
    expect(pdfPlainText(['um', '', 'três'])).toBe('um\n\ntrês')
    expect(pdfTextWithPages(['um', ' ', 'três'])).toBe('[p. 1]\num\n\n[p. 3]\ntrês')
    expect([...'Veja a [p. 12] e [pp. 3-4].'.matchAll(PAGE_REF)].map((m) => m[1])).toEqual(['12', '3'])
  })

  it('links e rótulos de anotações de PDF', () => {
    expect(pageLink(5, 12)).toBe('#/lesson/5?p=12')
    expect(pageLink(5, 3, 'Mód 1/apostila.pdf')).toBe('#/lesson/5?p=3&a=M%C3%B3d%201%2Fapostila.pdf')
    expect(noteLink(5, null, 12)).toBe('#/lesson/5?p=12')
    expect(noteLink(5, 125.7)).toBe('#/lesson/5?t=125')
    expect(noteWhere({ timestampSec: null, page: 3, assetPath: 'Mód/apostila.pdf' })).toBe('apostila.pdf, p. 3')
    expect(noteWhere({ timestampSec: 65, page: null, assetPath: null })).toBe('1:05')
    expect(noteMarkdown({ lessonId: 5, timestampSec: null, page: 12, assetPath: null, body: 'kernel' })).toBe('- [**p. 12**](#/lesson/5?p=12) kernel')
  })

  it('recursos do pdf.js só das pastas conhecidas', () => {
    expect(parsePdfjsUrl('tramotak-media://pdfjs/standard_fonts/FoxitSans.pfb')).toEqual({ dir: 'standard_fonts', file: 'FoxitSans.pfb' })
    expect(parsePdfjsUrl('tramotak-media://pdfjs/wasm/openjpeg.wasm')).toEqual({ dir: 'wasm', file: 'openjpeg.wasm' })
    expect(parsePdfjsUrl('tramotak-media://pdfjs/build/pdf.mjs')).toBeNull()
    expect(parsePdfjsUrl('tramotak-media://pdfjs/cmaps/../package.json')).toBeNull()
    expect(parsePdfjsUrl('tramotak-media://pdfjs/cmaps/..')).toBeNull()
  })

  it('conversa sobre PDF cita páginas e manda a página aberta junto da pergunta', () => {
    const system = buildChatSystem('[p. 1]\ntexto', { web: false, hasNotes: false, pdf: true })
    expect(system).toContain('[p. 12]')
    expect(system).not.toContain('[12:34]')
    expect(chatHistory([{ role: 'user', content: 'explique', at: 1, page: 4 }])).toEqual([{ role: 'user', content: '[página aberta: 4] explique' }])
  })
})

describe('PDF: banco, texto e material da IA', () => {
  let db: Database
  let course: Awaited<ReturnType<typeof makeCourse>>
  const lessonId = (title: string) => (db.prepare('SELECT id FROM lessons WHERE title LIKE ?').get(`%${title}%`) as { id: number }).id
  const scan = () => scanCourse(course.root, { structure: 'auto', numbering: 'dot' })

  beforeEach(async () => {
    course = await makeCourse(['01 Apostila.pdf', '02 Aula.mp4', '02 Aula.pdf', '03 Planilha.xlsx'])
    await writeFile(join(course.root, '01 Apostila.pdf'), makePdf([['Capitulo 1: o kernel gerencia processos.'], ['Containers compartilham o kernel.']]))
    await writeFile(join(course.root, '02 Aula.pdf'), makePdf([['Anexo: o comando ls lista arquivos.']]))
    db = openDatabase(':memory:')
    insertScannedCourse(db, { title: 'Linux', rootPath: course.root, numbering: 'dot', scanStructure: 'auto' }, await scan())
  })

  afterEach(async () => {
    db.close()
    await course.cleanup()
  })

  it('lê o texto de cada página do PDF', async () => {
    expect(await pdfPagesText(join(course.root, '01 Apostila.pdf'))).toEqual(['Capitulo 1: o kernel gerencia processos.', 'Containers compartilham o kernel.'])
  })

  it('confere o PDF: a própria aula ou um anexo PDF dela', () => {
    expect(assertPdf(db, lessonId('Apostila'), null)).toBeNull()
    expect(assertPdf(db, lessonId('Aula'), '02 Aula.pdf')).toBe('02 Aula.pdf')
    expect(() => assertPdf(db, lessonId('Aula'), null)).toThrow('não é um PDF')
    expect(() => assertPdf(db, lessonId('Planilha'), null)).toThrow('não é um PDF')
    expect(() => assertPdf(db, lessonId('Aula'), '../segredo.pdf')).toThrow('não encontrado')
    expect(getLessonView(db, lessonId('Aula')).assets.find((a) => a.kind === 'attachment')).toMatchObject({ relPath: '02 Aula.pdf', name: '02 Aula.pdf' })
  })

  it('grifos: cria, lista por PDF, muda a cor, apaga e sobrevivem a reescanear o curso', async () => {
    const aula = lessonId('Aula')
    const h = createHighlight(db, { lessonId: aula, assetPath: '02 Aula.pdf', page: 1, rects: [{ x: 0.1, y: 0.1, w: 0.3, h: 0.02 }], text: ' o comando   ls ', color: 'green' }, 50)
    expect(h).toMatchObject({ page: 1, text: 'o comando ls', color: 'green', assetPath: '02 Aula.pdf', createdAt: 50 })
    createHighlight(db, { lessonId: lessonId('Apostila'), assetPath: null, page: 2, rects: [{ x: 0, y: 0, w: 0.5, h: 0.1 }], text: 'kernel', color: 'yellow' })
    expect(listHighlights(db, aula, '02 Aula.pdf').map((x) => x.id)).toEqual([h.id])
    expect(listHighlights(db, lessonId('Apostila'), null)).toHaveLength(1)

    expect(() => createHighlight(db, { lessonId: aula, assetPath: '02 Aula.pdf', page: 0, rects: [{ x: 0, y: 0, w: 1, h: 1 }], text: '', color: 'green' })).toThrow('Página')
    expect(() => createHighlight(db, { lessonId: aula, assetPath: '02 Aula.pdf', page: 1, rects: [], text: '', color: 'green' })).toThrow('Selecione')
    expect(() => createHighlight(db, { lessonId: aula, assetPath: '02 Aula.pdf', page: 1, rects: [{ x: 0, y: 0, w: 1, h: 1 }], text: '', color: 'roxo' as never })).toThrow('Cor')

    setHighlightColor(db, h.id, 'pink')
    expect(listHighlights(db, aula, '02 Aula.pdf')[0].color).toBe('pink')

    // Reescanear recria os anexos (ids novos): grifos e notas ficam, pelo caminho do anexo
    createNote(db, { lessonId: aula, timestampSec: null, page: 1, assetPath: '02 Aula.pdf', body: 'nota no anexo' })
    revalidateCourse(db, (db.prepare('SELECT id FROM courses').get() as { id: number }).id, await scan())
    expect(listHighlights(db, aula, '02 Aula.pdf')).toHaveLength(1)
    expect(listNotes(db, aula)[0]).toMatchObject({ page: 1, assetPath: '02 Aula.pdf' })

    deleteHighlight(db, h.id)
    expect(listHighlights(db, aula, '02 Aula.pdf')).toEqual([])
    db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId('Apostila'))
    expect(db.prepare('SELECT COUNT(*) AS n FROM pdf_highlights').get()).toEqual({ n: 0 })
  })

  it('anotações por página: sem horário, ordenadas (aula, depois anexos) e só em PDFs', () => {
    const aula = lessonId('Aula')
    createNote(db, { lessonId: aula, timestampSec: 30, body: 'no vídeo' }, 1)
    createNote(db, { lessonId: aula, timestampSec: 99, page: 2, assetPath: '02 Aula.pdf', body: 'anexo p2' }, 2)
    createNote(db, { lessonId: aula, timestampSec: null, page: 1, assetPath: '02 Aula.pdf', body: 'anexo p1' }, 3)
    createNote(db, { lessonId: aula, timestampSec: null, body: 'solta' }, 4)
    expect(listNotes(db, aula).map((n) => [n.body, n.timestampSec, n.page])).toEqual([
      ['no vídeo', 30, null],
      ['anexo p1', null, 1],
      ['anexo p2', null, 2],
      ['solta', null, null]
    ])
    expect(() => createNote(db, { lessonId: aula, timestampSec: null, page: 3, body: 'x' })).toThrow('não é um PDF')
    const apostila = lessonId('Apostila')
    createNote(db, { lessonId: apostila, timestampSec: null, page: 2, body: 'página 2' })
    expect(listAllNotes(db).find((n) => n.body === 'página 2')).toMatchObject({ page: 2, assetPath: null })
  })

  it('progresso: aula em PDF guarda a página; tempo de leitura sem posição não mexe na posição', () => {
    const aula = lessonId('Aula')
    saveProgress(db, { lessonId: aula, positionSec: 42, durationSec: 100, watchedSec: 10 }, 1000)
    saveProgress(db, { lessonId: aula, positionSec: null, durationSec: null, watchedSec: 30 }, 1100)
    expect(getLessonView(db, aula).progress.positionSec).toBe(42)
    expect(db.prepare('SELECT SUM(seconds) AS s FROM study_sessions WHERE lesson_id = ?').get(aula)).toEqual({ s: 40 })
    saveProgress(db, { lessonId: lessonId('Apostila'), positionSec: 2, durationSec: null, watchedSec: 5 })
    expect(getLessonView(db, lessonId('Apostila')).progress.positionSec).toBe(2)
  })

  it('material da IA: texto do PDF da aula (padrão), anexos PDF só se marcados, conversa com páginas', async () => {
    const apostila = lessonId('Apostila')
    const source = await resolveSource(db, { kind: 'lesson', id: apostila })
    expect(source.sections.map((s) => [s.kind, s.label, s.defaultOn])).toEqual([['lesson-text', 'Texto do PDF', true]])
    expect(source.sections[0].text).toBe('Capitulo 1: o kernel gerencia processos.\n\nContainers compartilham o kernel.')

    const aula = await resolveSource(db, { kind: 'lesson', id: lessonId('Aula') })
    expect(aula.sections.map((s) => [s.kind, s.defaultOn])).toEqual([['attachments', false]])
    expect(aula.sections[0].text).toContain('o comando ls lista arquivos')

    const chat = await chatMaterial(db, apostila, false)
    expect(chat.info.kind).toBe('pdf')
    expect(chat.text).toContain('[p. 2]\nContainers compartilham o kernel.')
    expect(chat.text).not.toContain('Apostila')

    expect((await reviewMaterial(db, apostila)).text).toContain('Containers compartilham o kernel.')
  })
})
