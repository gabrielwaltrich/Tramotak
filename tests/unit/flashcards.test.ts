import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_DECK_OPTIONS } from '@shared/srs'
const NEW_CARDS_PER_DAY = DEFAULT_DECK_OPTIONS.newPerDay
import { openDatabase, type Database } from '../../src/main/db/database'
import { deleteCourse, insertScannedCourse } from '../../src/main/db/courses'
import { getDashboard } from '../../src/main/db/dashboard'
import {
  answerCard,
  createCard,
  createDeck,
  deckForCourse,
  deleteDeck,
  dueToday,
  getDeck,
  listDecks,
  nextStudyCard,
  ensureMemoryStates,
  resetCard,
  updateCard,
  updateDeck
} from '../../src/main/db/flashcards'
import { search } from '../../src/main/db/search'
import { scanCourse } from '../../src/main/scanner/scan'
import { makeCourse } from '../helpers/fixture'

let db: Database
let deckId: number
const now = Math.floor(new Date(2026, 9, 11, 15, 0).getTime() / 1000)
const MIN = 60
const DAY = 86_400
const mid = () => 0.5

beforeEach(() => {
  db = openDatabase(':memory:')
  deckId = createDeck(db, { title: 'Cálculo' })
})
afterEach(() => db.close())

const add = (front: string, back = 'resposta') => createCard(db, { deckId, front, back }).id
const counts = (at = now) => {
  const d = listDecks(db, at).find((x) => x.id === deckId)!
  return { n: d.newCount, l: d.learningCount, r: d.reviewCount, total: d.total }
}

describe('baralhos e cartas', () => {
  it('cria, edita, valida e conta', () => {
    const id = add('  O que é uma integral?  ', ' Área sob a curva ')
    expect(getDeck(db, deckId, now).cards).toEqual([
      expect.objectContaining({ id, front: 'O que é uma integral?', back: 'Área sob a curva', state: 'new' })
    ])
    expect(updateCard(db, id, { front: 'Integral?', back: 'Área' })).toMatchObject({ front: 'Integral?' })
    expect(() => add('   ')).toThrow('frente')
    expect(() => createDeck(db, { title: ' ' })).toThrow('nome')
    expect(counts()).toEqual({ n: 1, l: 0, r: 0, total: 1 })
  })

  it('excluir o baralho apaga as cartas e o histórico', () => {
    const id = add('a')
    answerCard(db, id, 3, 1000, now)
    deleteDeck(db, deckId)
    for (const t of ['decks', 'cards', 'reviews']) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n, t).toBe(0)
    }
  })

  it('cartas entram na busca global', () => {
    add('Teorema fundamental do cálculo', 'liga derivada e integral')
    const hits = search(db, 'teorema')
    expect(hits).toEqual([expect.objectContaining({ kind: 'card', deckId, deckTitle: 'Cálculo' })])
    expect(search(db, 'integral').map((h) => h.kind)).toContain('card')
  })
})

describe('fila de estudo', () => {
  it('novas → aprendizado → graduação, na ordem do Anki', () => {
    const a = add('a')
    const b = add('b')

    let next = nextStudyCard(db, deckId, now)
    expect(next.next?.card.id).toBe(a)
    expect(next.next?.intervals).toEqual({ 1: 60, 2: 330, 3: 600, 4: expect.any(Number) })

    answerCard(db, a, 3, 5000, now, mid) // a: aprendizado, volta em 10 min
    next = nextStudyCard(db, deckId, now)
    expect(next.next?.card.id).toBe(b) // a ainda não venceu

    answerCard(db, b, 1, 5000, now, mid) // b: volta em 1 min
    // Sem novas, adianta o aprendizado que vence logo (dentro de 20 min): b primeiro
    expect(nextStudyCard(db, deckId, now).next?.card.id).toBe(b)
    expect(nextStudyCard(db, deckId, now + 10 * MIN).next?.card.id).toBe(b)

    answerCard(db, a, 3, 5000, now + 10 * MIN, mid) // a gradua para o intervalo do FSRS (alguns dias)
    const graduated = getDeck(db, deckId, now).cards.find((c) => c.id === a)!
    expect(graduated.state).toBe('review')
    expect(graduated.intervalDays).toBeGreaterThanOrEqual(2)
    expect(graduated.stability).toBeGreaterThan(2)
    expect(counts(now + 10 * MIN)).toEqual({ n: 0, l: 1, r: 0, total: 2 })
  })

  it('sem nada para agora, informa quando volta uma carta em aprendizado', () => {
    const a = add('a')
    answerCard(db, a, 3, 1000, now, mid) // vence em 10 min, dentro do adiantamento
    answerCard(db, a, 3, 1000, now + 10 * MIN, mid) // review amanhã
    expect(nextStudyCard(db, deckId, now + 11 * MIN)).toEqual({ next: null, nextLearningAt: null })

    const b = add('b')
    answerCard(db, b, 1, 1000, now, mid)
    answerCard(db, b, 2, 1000, now + MIN, mid) // ainda em aprendizado
    const later = nextStudyCard(db, deckId, now - 30 * MIN) // antes de vencer e fora do adiantamento
    expect(later.next).toBeNull()
  })

  it('revisões vencem no dia certo e respeitam o limite diário de novas', () => {
    for (let i = 0; i < NEW_CARDS_PER_DAY + 5; i++) add(`c${i}`)
    expect(counts().n).toBe(NEW_CARDS_PER_DAY)

    const first = getDeck(db, deckId, now).cards[0].id
    answerCard(db, first, 4, 1000, now, mid) // Fácil: 8 dias
    expect(counts().n).toBe(NEW_CARDS_PER_DAY - 1)
    expect(counts(now + 7 * DAY).r).toBe(0)
    expect(counts(now + 8 * DAY).r).toBe(1)
    expect(counts(now + 8 * DAY).n).toBe(NEW_CARDS_PER_DAY) // novo dia, limite renovado
  })

  it('opções do baralho: limites diários, etapas e retenção', () => {
    for (let i = 0; i < 8; i++) add(`c${i}`)
    updateDeck(db, deckId, { title: 'Cálculo', description: '', options: { ...DEFAULT_DECK_OPTIONS, newPerDay: 3, learningStepsMin: [5] } })
    expect(counts().n).toBe(3)
    const next = nextStudyCard(db, deckId, now).next!
    expect(next.intervals[1]).toBe(5 * MIN)
    // Editar só o nome mantém as opções
    updateDeck(db, deckId, { title: 'Cálculo I', description: '' })
    expect(listDecks(db, now).find((d) => d.id === deckId)!.options).toMatchObject({ newPerDay: 3, learningStepsMin: [5] })
    // Opções inválidas viram valores aceitos
    updateDeck(db, deckId, { title: 'Cálculo I', description: '', options: { ...DEFAULT_DECK_OPTIONS, desiredRetention: 2 } })
    expect(getDeck(db, deckId, now).options.desiredRetention).toBe(0.97)
  })

  it('cada resposta guarda a memória do FSRS na carta e no histórico', () => {
    const a = add('a')
    answerCard(db, a, 3, 1000, now, mid)
    const card = getDeck(db, deckId, now).cards[0]
    expect(card.stability).toBeCloseTo(2.3065, 3)
    expect(card.difficulty).toBeGreaterThan(1)
    const review = db.prepare('SELECT stability_after AS s, difficulty_after AS d FROM reviews WHERE card_id = ?').get(a) as { s: number; d: number }
    expect(review.s).toBeCloseTo(card.stability!, 6)
    expect(review.d).toBeCloseTo(card.difficulty!, 6)
  })

  it('cartas do SM-2 ganham memória pelo histórico ou pela facilidade, sem mudar a data', () => {
    const a = add('a')
    const b = add('b')
    answerCard(db, a, 3, 1000, now, mid)
    answerCard(db, a, 3, 1000, now + 10 * MIN, mid)
    const expected = getDeck(db, deckId, now).cards.find((c) => c.id === a)!
    // Como se tivessem sido agendadas antes do FSRS: sem memória; b veio de um pacote antigo, sem histórico.
    db.prepare('UPDATE cards SET stability = NULL, difficulty = NULL WHERE id = ?').run(a)
    db.prepare("UPDATE cards SET state = 'review', interval_days = 12, ease = 1.3, due = ?, last_review_at = ? WHERE id = ?").run(
      now + 2 * DAY, now - 10 * DAY, b
    )
    expect(ensureMemoryStates(db)).toBe(2)
    expect(ensureMemoryStates(db)).toBe(0)
    const cards = getDeck(db, deckId, now).cards
    const ca = cards.find((c) => c.id === a)!
    const cb = cards.find((c) => c.id === b)!
    expect(ca.stability).toBeCloseTo(expected.stability!, 6)
    expect(ca.due).toBe(expected.due)
    expect(cb).toMatchObject({ stability: 12, due: now + 2 * DAY })
    expect(cb.difficulty).toBeCloseTo(9.8)
  })

  it('reset volta a carta para nova', () => {
    const a = add('a')
    answerCard(db, a, 4, 1000, now, mid)
    resetCard(db, a)
    expect(getDeck(db, deckId, now).cards[0]).toMatchObject({ state: 'new', intervalDays: 0 })
  })

  it('o tempo de resposta soma na meta diária (limitado a 60 s por carta)', () => {
    const a = add('a')
    const b = add('b')
    answerCard(db, a, 3, 8000, now, mid)
    answerCard(db, b, 3, 600_000, now + 10, mid)
    expect(getDashboard(db, new Date(now * 1000)).todaySeconds).toBe(68)
  })

  it('recusa resposta inválida', () => {
    const a = add('a')
    expect(() => answerCard(db, a, 5 as never, 0, now)).toThrow('inválida')
  })

  it('dueToday soma o que dá para estudar em todos os baralhos', () => {
    add('a')
    createCard(db, { deckId: createDeck(db, { title: 'Outro' }), front: 'x', back: '' })
    expect(dueToday(db, now)).toBe(2)
  })
})

describe('cartas ligadas a aulas', () => {
  it('guardam aula e horário; excluir o curso desliga a carta, sem apagá-la', async () => {
    const course = await makeCourse(['1. Aula.mp4'])
    const scan = await scanCourse(course.root, { structure: 'auto', numbering: 'dot' })
    const courseId = insertScannedCourse(db, { title: 'Física', rootPath: course.root, numbering: 'dot', scanStructure: 'auto' }, scan)
    const lessonId = (db.prepare('SELECT id FROM lessons').get() as { id: number }).id

    const courseDeck = deckForCourse(db, courseId)
    expect(deckForCourse(db, courseId)).toBe(courseDeck) // reaproveita
    expect(listDecks(db, now).find((d) => d.id === courseDeck)).toMatchObject({ title: 'Física', courseTitle: 'Física' })

    const card = createCard(db, { deckId: courseDeck, front: 'F = m·a', back: '2ª lei', lessonId, timestampSec: 95.5 })
    expect(card).toMatchObject({ lessonId, lessonTitle: 'Aula', courseId, timestampSec: 95.5 })

    deleteCourse(db, courseId)
    expect(getDeck(db, courseDeck, now).cards[0]).toMatchObject({ lessonId: null, front: 'F = m·a' })
    await course.cleanup()
  })
})
