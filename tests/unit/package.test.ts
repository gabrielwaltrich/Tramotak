import { tmpdir } from 'node:os'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Database } from '../../src/main/db/database'
import { insertScannedCourse } from '../../src/main/db/courses'
import { createNote, listNotes } from '../../src/main/db/notes'
import { saveProgress, setCompleted, setFavorite } from '../../src/main/db/lessons'
import { getTranscript, saveTranscript } from '../../src/main/db/media'
import { createCard, createDeck, getDeck, answerCard } from '../../src/main/db/flashcards'
import { DEFAULT_DECK_OPTIONS } from '@shared/srs'
import { createBank, createExam, createQuestion, listExams, listQuestions } from '../../src/main/db/questions'
import { createNotebook, createPage, notebookPages, savePage } from '../../src/main/db/notebooks'
import { createMindMap, getMindMap } from '../../src/main/db/mindmaps'
import { scanCourse } from '../../src/main/scanner/scan'
import { buildPackage, exportCatalog, importPackage, parsePackage, previewPackage, serializePackage } from '../../src/main/backup/package'
import { createMap, addChild, setAttachment } from '@shared/mindmap'
import { makeCourse } from '../helpers/fixture'

const FILES = ['01 Limites/01 Introdução.mp4', '01 Limites/02 Laterais.mp4', '02 Derivadas/01 Definição.mp4']
let a: Database
let b: Database
let cleanups: (() => Promise<void>)[] = []

async function importCourse(db: Database, title: string): Promise<{ courseId: number; lesson: (t: string) => number }> {
  const course = await makeCourse(FILES)
  cleanups.push(course.cleanup)
  const scan = await scanCourse(course.root, { structure: 'auto', numbering: 'dot' })
  const courseId = insertScannedCourse(db, { title, rootPath: course.root, numbering: 'dot', scanStructure: 'auto' }, scan)
  return { courseId, lesson: (t) => (db.prepare('SELECT id FROM lessons WHERE course_id = ? AND title LIKE ?').get(courseId, `%${t}%`) as { id: number }).id }
}

const SEL = { courseIds: [], deckIds: [], bankIds: [], notebookIds: [], mindmapIds: [], includeSchedule: true, includeProgress: true }

beforeEach(() => {
  a = openDatabase(':memory:')
  b = openDatabase(':memory:')
})

afterEach(async () => {
  a.close()
  b.close()
  await Promise.all(cleanups.map((c) => c()))
  cleanups = []
})

describe('pacotes de estudo', () => {
  it('exporta de um computador e importa no outro com tudo ligado às aulas certas', async () => {
    const src = await importCourse(a, 'Cálculo I')
    const intro = src.lesson('Introdução')
    createNote(a, { lessonId: intro, timestampSec: 30, body: 'limite é aproximação' })
    saveProgress(a, { lessonId: intro, positionSec: 120, durationSec: 600, watchedSec: 10 })
    setCompleted(a, intro, true)
    setFavorite(a, intro, true)
    saveTranscript(a, intro, { provider: 'groq', model: 'w', language: 'pt', segments: [{ start: 0, end: 2, text: 'olá' }] })

    const deckId = createDeck(a, { title: 'Cartas de cálculo', courseId: src.courseId, options: { ...DEFAULT_DECK_OPTIONS, desiredRetention: 0.85, newPerDay: 7 } })
    const card = createCard(a, { deckId, front: 'O que é limite?', back: 'Aproximação', lessonId: intro, timestampSec: 30 })
    answerCard(a, card.id, 3, 5000)
    createCard(a, { deckId, front: 'Carta solta', back: 'sem aula' })

    const bankId = createBank(a, { title: 'Banco de cálculo' })
    const q1 = createQuestion(a, bankId, { type: 'truefalse', statement: 'Limite existe se laterais iguais', options: [], key: { type: 'truefalse', correct: true }, explanation: '', topic: 'Limites', difficulty: 2, points: 1 })
    createQuestion(a, bankId, { type: 'short', statement: 'Derivada de x²?', options: [], key: { type: 'short', accepted: ['2x'] }, explanation: '', topic: 'Derivadas', difficulty: 1, points: 1 })
    createExam(a, bankId, { title: 'Só a primeira', selection: { mode: 'manual', questionIds: [q1.id] } })

    const nbId = createNotebook(a, 'Resumos')
    const firstPage = notebookPages(a, nbId)[0]
    savePage(a, firstPage.id, {
      title: 'Limites',
      blocks: [
        { id: 't', type: 'text', text: 'Resumo $x^2$' },
        { id: 'l', type: 'resource', resource: { kind: 'lesson', id: intro, title: 'Introdução' } },
        { id: 'd', type: 'resource', resource: { kind: 'deck', id: deckId, title: 'Cartas de cálculo' } },
        { id: 'x', type: 'resource', resource: { kind: 'bank', id: 999, title: 'Banco que não foi exportado' } }
      ]
    })
    const second = createPage(a, nbId)
    savePage(a, second.id, { title: 'Página 2', blocks: [{ id: 't2', type: 'text', text: 'mais' }] })

    let map = createMap('Cálculo')
    const branch = addChild(map, map.rootId, 'Introdução')
    map = setAttachment(branch.map, branch.id, { kind: 'lesson', id: intro, title: 'Introdução' })
    const mapId = createMindMap(a, 'Mapa', map)

    const catalog = exportCatalog(a)
    expect(catalog.courses[0]).toMatchObject({ title: 'Cálculo I', notes: 1, transcripts: 1, completed: 1 })
    expect(catalog.decks[0].cards).toBe(2)

    const pkg = buildPackage(a, { ...SEL, courseIds: [src.courseId], deckIds: [deckId], bankIds: [bankId], notebookIds: [nbId], mindmapIds: [mapId] }, '0.3.0')
    // O pacote não carrega caminhos do disco
    expect(JSON.stringify(pkg)).not.toContain(tmpdir())
    const file = serializePackage(pkg)
    expect(file[0]).toBe(0x1f)

    // Outro computador: mesmo curso, em outra pasta e com outro título
    const dst = await importCourse(b, 'Calculo (cópia)')
    b.prepare("INSERT INTO courses (title, root_path, structure, numbering) VALUES ('Outro curso', '/x', 'flat', 'dot')").run()
    const parsed = parsePackage(file)
    const preview = previewPackage(b, parsed, 't1')
    expect(preview.courses).toEqual([expect.objectContaining({ key: 'c1', title: 'Cálculo I', withData: true, notes: 1, match: dst.courseId })])
    expect(preview.decks).toEqual([{ title: 'Cartas de cálculo', cards: 2 }])

    const result = importPackage(b, parsed, { c1: dst.courseId })
    expect(result).toMatchObject({ decks: 1, cards: 2, banks: 1, questions: 2, notebooks: 1, mindmaps: 1, notes: 1, progress: 1, transcripts: 1, unlinked: 1 })

    const introB = dst.lesson('Introdução')
    expect(listNotes(b, introB).map((n) => [n.body, n.timestampSec])).toEqual([['limite é aproximação', 30]])
    expect(b.prepare('SELECT position_sec AS p, completed_at IS NOT NULL AS done, favorite FROM lesson_progress WHERE lesson_id = ?').get(introB)).toEqual({ p: 120, done: 1, favorite: 1 })
    expect(getTranscript(b, introB)?.segments[0].text).toBe('olá')

    const deckB = getDeck(b, (b.prepare('SELECT id FROM decks').get() as { id: number }).id)
    expect(deckB.courseId).toBe(dst.courseId)
    const linked = deckB.cards.find((c) => c.front === 'O que é limite?')!
    expect(linked).toMatchObject({ lessonId: introB, timestampSec: 30 })
    expect(linked.state).not.toBe('new') // agendamento veio junto
    const original = getDeck(a, deckId).cards.find((c) => c.front === 'O que é limite?')!
    expect(linked.stability).toBeCloseTo(original.stability!, 6) // e a memória do FSRS
    expect(linked.difficulty).toBeCloseTo(original.difficulty!, 6)
    expect(deckB.options).toMatchObject({ desiredRetention: 0.85, newPerDay: 7 })

    const bankB = (b.prepare('SELECT id FROM question_banks').get() as { id: number }).id
    const questionsB = listQuestions(b, bankB)
    expect(questionsB).toHaveLength(2)
    const exam = listExams(b, bankB)[0]
    expect(exam.selection).toEqual({ mode: 'manual', questionIds: [questionsB.find((q) => q.type === 'truefalse')!.id] })

    const nbB = (b.prepare('SELECT id FROM notebooks').get() as { id: number }).id
    const pagesB = notebookPages(b, nbB)
    expect(pagesB.map((p) => p.title)).toEqual(['Limites', 'Página 2'])
    expect(pagesB[0].blocks.map((x) => (x.type === 'resource' ? `${x.resource.kind}:${x.resource.id}` : x.type))).toEqual(['text', `lesson:${introB}`, `deck:${deckB.id}`])

    const mapB = getMindMap(b, (b.prepare('SELECT id FROM mindmaps').get() as { id: number }).id)
    expect(mapB.data.nodes.find((n) => n.text === 'Introdução')!.attachment).toEqual({ kind: 'lesson', id: introB, title: 'Introdução' })
  })

  it('sem agendamento as cartas entram como novas; sem curso ligado, as ligações caem e os dados do curso ficam de fora', async () => {
    const src = await importCourse(a, 'Cálculo I')
    const intro = src.lesson('Introdução')
    createNote(a, { lessonId: intro, timestampSec: null, body: 'nota' })
    const deckId = createDeck(a, { title: 'D' })
    const card = createCard(a, { deckId, front: 'F', back: 'B', lessonId: intro })
    answerCard(a, card.id, 4, 1000)

    const pkg = parsePackage(serializePackage(buildPackage(a, { ...SEL, courseIds: [src.courseId], deckIds: [deckId], includeSchedule: false }, '0.3.0')))
    const result = importPackage(b, pkg, { c1: null })
    expect(result).toMatchObject({ cards: 1, notes: 0, unlinked: 1 })
    const deckB = getDeck(b, (b.prepare('SELECT id FROM decks').get() as { id: number }).id)
    expect(deckB.cards[0]).toMatchObject({ state: 'new', lessonId: null, timestampSec: null })
  })

  it('importar duas vezes não duplica anotações; progresso mantém o que estiver mais adiantado', async () => {
    const src = await importCourse(a, 'C')
    const dst = await importCourse(b, 'C')
    const introA = src.lesson('Introdução')
    const introB = dst.lesson('Introdução')
    createNote(a, { lessonId: introA, timestampSec: 5, body: 'n' })
    saveProgress(a, { lessonId: introA, positionSec: 50, durationSec: 100, watchedSec: 1 })
    a.prepare('UPDATE lesson_progress SET last_watched_at = 100').run()
    saveProgress(b, { lessonId: introB, positionSec: 80, durationSec: 100, watchedSec: 1 })
    b.prepare('UPDATE lesson_progress SET last_watched_at = 200').run()

    const pkg = parsePackage(serializePackage(buildPackage(a, { ...SEL, courseIds: [src.courseId] }, '0.3.0')))
    importPackage(b, pkg, { c1: dst.courseId })
    importPackage(b, pkg, { c1: dst.courseId })
    expect(listNotes(b, introB)).toHaveLength(1)
    expect(b.prepare('SELECT position_sec AS p FROM lesson_progress WHERE lesson_id = ?').get(introB)).toEqual({ p: 80 })
  })

  it('recusa arquivos estranhos e de versão futura; descarta itens malformados', () => {
    expect(() => parsePackage(Buffer.from('oi'))).toThrow(/não é um pacote/)
    expect(() => parsePackage(Buffer.from(JSON.stringify({ format: 'outro' })))).toThrow(/não é um pacote/)
    expect(() => parsePackage(Buffer.from(JSON.stringify({ format: 'tramotak-package', version: 99 })))).toThrow(/versão mais nova/)
    expect(() => parsePackage(Buffer.from([0x1f, 0x8b, 1, 2, 3]))).toThrow(/corrompido/)
    const pkg = parsePackage(
      gzipSync(
        JSON.stringify({
          format: 'tramotak-package',
          version: 1,
          decks: [{ key: 'd1', title: 'D', cards: [{ front: '', back: 'x' }, { front: 'ok', back: 'y', schedule: { state: 'hack', due: 1 } }] }, { title: 'sem chave' }],
          banks: [{ key: 'b1', title: 'B', questions: [{ pid: 'q1', type: 'single', statement: 'sem alternativas', options: [], key: { type: 'single', correct: 'x' } }] }],
          mindmaps: [{ title: 'ruim', data: { nodes: 'x' } }]
        })
      )
    )
    expect(pkg.decks).toHaveLength(1)
    expect(pkg.decks[0].cards).toEqual([{ front: 'ok', back: 'y', ref: null, timestampSec: null }])
    expect(pkg.banks[0].questions).toEqual([])
    expect(pkg.mindmaps).toEqual([])
  })
})
