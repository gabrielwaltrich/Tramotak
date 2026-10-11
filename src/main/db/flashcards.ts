import {
  MAX_CARD_FIELD,
  NEW_CARDS_PER_DAY,
  REVIEWS_PER_DAY,
  type CardView,
  type DeckDetail,
  type DeckSummary,
  type NewCard,
  type StudyNext
} from '@shared/flashcards'
import { previewIntervals, schedule, startOfLocalDay, type CardState, type Rating, type SchedulingState } from '@shared/srs'
import { transaction, type Database } from './database'
import { recordStudyTime } from './study'

/** Cartas em aprendizado que vencem dentro disso podem ser adiantadas quando não há mais nada. */
const LEARN_AHEAD_SEC = 20 * 60
/** Tempo máximo contado por resposta (evita somar o tempo em que a pessoa saiu da frente da tela). */
const MAX_ANSWER_MS = 60_000

const nowSec = () => Math.floor(Date.now() / 1000)

function endOfLocalDay(epochSec: number): number {
  const d = new Date(epochSec * 1000)
  d.setHours(24, 0, 0, 0)
  return Math.floor(d.getTime() / 1000)
}

function cleanField(value: unknown, field: string, required: boolean): string {
  const text = String(value ?? '').trim()
  if (required && !text) throw new Error(`A ${field} não pode ficar vazia`)
  if (text.length > MAX_CARD_FIELD) throw new Error(`A ${field} passa de ${MAX_CARD_FIELD.toLocaleString('pt-BR')} caracteres`)
  return text
}

function cleanTitle(value: unknown): string {
  const title = String(value ?? '').trim()
  if (!title) throw new Error('O nome do baralho não pode ficar vazio')
  return title.slice(0, 200)
}

// ── Baralhos ────────────────────────────────────────────────────────────────

interface DeckRow {
  id: number
  title: string
  description: string
  courseId: number | null
  courseTitle: string | null
}

const DECK_SELECT = `SELECT d.id, d.title, d.description, d.course_id AS courseId, c.title AS courseTitle
  FROM decks d LEFT JOIN courses c ON c.id = d.course_id`

function deckCounts(db: Database, deckId: number, now: number) {
  const dayStart = startOfLocalDay(now)
  const dayEnd = endOfLocalDay(now)
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(state = 'new') AS newTotal,
              SUM(state IN ('learning', 'relearning') AND due < ?) AS learning,
              SUM(state = 'review' AND due < ?) AS reviewDue
         FROM cards WHERE deck_id = ?`
    )
    .get(dayEnd, dayEnd, deckId) as { total: number; newTotal: number | null; learning: number | null; reviewDue: number | null }
  const today = db
    .prepare(
      `SELECT SUM(r.state_before = 'new') AS newDone, SUM(r.state_before = 'review') AS reviewsDone
         FROM reviews r JOIN cards c ON c.id = r.card_id
        WHERE c.deck_id = ? AND r.reviewed_at >= ?`
    )
    .get(deckId, dayStart) as { newDone: number | null; reviewsDone: number | null }

  return {
    total: row.total,
    newCount: Math.min(row.newTotal ?? 0, Math.max(0, NEW_CARDS_PER_DAY - (today.newDone ?? 0))),
    learningCount: row.learning ?? 0,
    reviewCount: Math.min(row.reviewDue ?? 0, Math.max(0, REVIEWS_PER_DAY - (today.reviewsDone ?? 0)))
  }
}

function summarize(db: Database, row: DeckRow, now: number): DeckSummary {
  return { ...row, ...deckCounts(db, row.id, now) }
}

export function listDecks(db: Database, now = nowSec()): DeckSummary[] {
  const rows = db.prepare(`${DECK_SELECT} ORDER BY d.updated_at DESC, d.id DESC`).all() as unknown as DeckRow[]
  return rows.map((row) => summarize(db, row, now))
}

function getDeckRow(db: Database, deckId: number): DeckRow {
  const row = db.prepare(`${DECK_SELECT} WHERE d.id = ?`).get(deckId) as unknown as DeckRow | undefined
  if (!row) throw new Error('Baralho não encontrado')
  return row
}

export function createDeck(db: Database, input: { title: string; description?: string; courseId?: number | null }): number {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO decks (title, description, course_id) VALUES (?, ?, ?)')
    .run(cleanTitle(input.title), String(input.description ?? '').trim(), input.courseId ?? null)
  return Number(lastInsertRowid)
}

export function updateDeck(db: Database, deckId: number, patch: { title: string; description: string }): void {
  const { changes } = db
    .prepare('UPDATE decks SET title = ?, description = ?, updated_at = unixepoch() WHERE id = ?')
    .run(cleanTitle(patch.title), String(patch.description ?? '').trim(), deckId)
  if (!changes) throw new Error('Baralho não encontrado')
}

export function deleteDeck(db: Database, deckId: number): void {
  db.prepare('DELETE FROM decks WHERE id = ?').run(deckId)
}

/** Baralho do curso (o mais recente ligado a ele) ou um novo com o nome do curso. */
export function deckForCourse(db: Database, courseId: number): number {
  const existing = db.prepare('SELECT id FROM decks WHERE course_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1').get(courseId) as
    | { id: number }
    | undefined
  if (existing) return existing.id
  const course = db.prepare('SELECT title FROM courses WHERE id = ?').get(courseId) as { title: string } | undefined
  if (!course) throw new Error('Curso não encontrado')
  return createDeck(db, { title: course.title, courseId })
}

// ── Cartas ──────────────────────────────────────────────────────────────────

const CARD_SELECT = `SELECT k.id, k.deck_id AS deckId, k.front, k.back, k.state, k.due, k.interval_days AS intervalDays,
    k.lesson_id AS lessonId, l.title AS lessonTitle, l.course_id AS courseId, k.timestamp_sec AS timestampSec
  FROM cards k LEFT JOIN lessons l ON l.id = k.lesson_id`

export function getDeck(db: Database, deckId: number, now = nowSec()): DeckDetail {
  const summary = summarize(db, getDeckRow(db, deckId), now)
  const cards = db.prepare(`${CARD_SELECT} WHERE k.deck_id = ? ORDER BY k.id`).all(deckId) as unknown as CardView[]
  return { ...summary, cards }
}

function getCard(db: Database, cardId: number): CardView {
  const card = db.prepare(`${CARD_SELECT} WHERE k.id = ?`).get(cardId) as unknown as CardView | undefined
  if (!card) throw new Error('Carta não encontrada')
  return card
}

export function createCard(db: Database, input: NewCard): CardView {
  getDeckRow(db, input.deckId)
  const timestamp =
    typeof input.timestampSec === 'number' && Number.isFinite(input.timestampSec) ? Math.max(0, input.timestampSec) : null
  const { lastInsertRowid } = db
    .prepare('INSERT INTO cards (deck_id, front, back, lesson_id, timestamp_sec) VALUES (?, ?, ?, ?, ?)')
    .run(input.deckId, cleanField(input.front, 'frente', true), cleanField(input.back, 'resposta', false), input.lessonId ?? null, timestamp)
  db.prepare('UPDATE decks SET updated_at = unixepoch() WHERE id = ?').run(input.deckId)
  return getCard(db, Number(lastInsertRowid))
}

export function updateCard(db: Database, cardId: number, patch: { front: string; back: string }): CardView {
  const { changes } = db
    .prepare('UPDATE cards SET front = ?, back = ?, updated_at = unixepoch() WHERE id = ?')
    .run(cleanField(patch.front, 'frente', true), cleanField(patch.back, 'resposta', false), cardId)
  if (!changes) throw new Error('Carta não encontrada')
  return getCard(db, cardId)
}

export function deleteCard(db: Database, cardId: number): void {
  db.prepare('DELETE FROM cards WHERE id = ?').run(cardId)
}

/** Volta a carta para "nova", apagando o agendamento (o histórico de respostas fica). */
export function resetCard(db: Database, cardId: number): void {
  db.prepare(
    `UPDATE cards SET state = 'new', step = 0, interval_days = 0, ease = 2.5, due = 0, reps = 0, lapses = 0,
       last_review_at = NULL, updated_at = unixepoch() WHERE id = ?`
  ).run(cardId)
}

// ── Estudo ──────────────────────────────────────────────────────────────────

interface SchedulingRow {
  id: number
  state: CardState
  step: number
  intervalDays: number
  ease: number
  due: number
  reps: number
  lapses: number
  lastReviewAt: number | null
}

const SCHED_SELECT = `SELECT id, state, step, interval_days AS intervalDays, ease, due, reps, lapses,
  last_review_at AS lastReviewAt FROM cards`

function toState(row: SchedulingRow): SchedulingState {
  const { id: _id, ...state } = row
  void _id
  return state
}

/**
 * Próxima carta, na ordem do Anki: aprendizado vencido → revisões de hoje → novas →
 * aprendizado que vence em breve (adiantado só quando não sobra mais nada).
 */
export function nextStudyCard(db: Database, deckId: number, now = nowSec()): StudyNext {
  getDeckRow(db, deckId)
  const counts = deckCounts(db, deckId, now)
  const dayEnd = endOfLocalDay(now)
  const pick = (sql: string, ...params: (number | string)[]) =>
    db.prepare(`${SCHED_SELECT} WHERE deck_id = ? AND ${sql} LIMIT 1`).get(deckId, ...params) as unknown as SchedulingRow | undefined

  const row =
    pick("state IN ('learning', 'relearning') AND due <= ? ORDER BY due, id", now) ??
    (counts.reviewCount > 0 ? pick("state = 'review' AND due < ? ORDER BY due, id", dayEnd) : undefined) ??
    (counts.newCount > 0 ? pick("state = 'new' ORDER BY id") : undefined) ??
    pick("state IN ('learning', 'relearning') AND due <= ? ORDER BY due, id", now + LEARN_AHEAD_SEC)

  if (!row) {
    const later = db
      .prepare("SELECT MIN(due) AS due FROM cards WHERE deck_id = ? AND state IN ('learning', 'relearning') AND due < ?")
      .get(deckId, dayEnd) as { due: number | null }
    return { next: null, nextLearningAt: later.due }
  }

  return {
    next: {
      card: getCard(db, row.id),
      intervals: previewIntervals(toState(row), now),
      counts: { newCount: counts.newCount, learningCount: counts.learningCount, reviewCount: counts.reviewCount }
    },
    nextLearningAt: null
  }
}

/** Registra a resposta, reagenda a carta e soma o tempo à meta diária. */
export function answerCard(
  db: Database,
  cardId: number,
  rating: Rating,
  durationMs: number,
  now = nowSec(),
  random: () => number = Math.random
): void {
  if (![1, 2, 3, 4].includes(rating)) throw new Error('Resposta inválida')
  const row = db.prepare(`${SCHED_SELECT} WHERE id = ?`).get(cardId) as unknown as SchedulingRow | undefined
  if (!row) throw new Error('Carta não encontrada')
  const before = toState(row)
  const after = schedule(before, rating, now, { random })
  const duration = Math.min(MAX_ANSWER_MS, Math.max(0, Math.round(durationMs || 0)))

  transaction(db, () => {
    db.prepare(
      `UPDATE cards SET state = ?, step = ?, interval_days = ?, ease = ?, due = ?, reps = ?, lapses = ?,
         last_review_at = ? WHERE id = ?`
    ).run(after.state, after.step, after.intervalDays, after.ease, after.due, after.reps, after.lapses, after.lastReviewAt, cardId)
    db.prepare(
      `INSERT INTO reviews (card_id, reviewed_at, rating, state_before, interval_before, interval_after, ease_after, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(cardId, now, rating, before.state, before.intervalDays, after.intervalDays, after.ease, duration)
    recordStudyTime(db, null, duration / 1000, now)
  })
}

/** Total para o Início: o que dá para estudar hoje somando todos os baralhos. */
export function dueToday(db: Database, now = nowSec()): number {
  return listDecks(db, now).reduce((sum, d) => sum + d.newCount + d.learningCount + d.reviewCount, 0)
}
