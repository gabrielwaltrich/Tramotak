import { isAnswered, type QuestionAnswer, type QuestionInput } from '@shared/questions'
import { reviewScore, type LessonReview, type ReviewSummary } from '@shared/review'
import type { Database } from './database'

interface Row {
  questions: string
  answers: string
  total: number
  correct: number | null
  createdAt: number
  finishedAt: number | null
}

const SELECT = `SELECT questions_json AS questions, answers_json AS answers, total, correct, created_at AS createdAt, finished_at AS finishedAt
  FROM lesson_reviews WHERE lesson_id = ?`

function parseList<T>(json: string): T[] {
  try {
    const list = JSON.parse(json)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/** Última revisão da aula (perguntas e respostas), ou `null`. */
export function getReview(db: Database, lessonId: number): LessonReview | null {
  const row = db.prepare(SELECT).get(lessonId) as Row | undefined
  if (!row) return null
  const questions = parseList<QuestionInput>(row.questions)
  const answers = parseList<QuestionAnswer | null>(row.answers)
  return {
    lessonId,
    questions,
    answers: questions.map((_, i) => answers[i] ?? null),
    total: row.total,
    correct: row.correct,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt
  }
}

export function reviewSummary(db: Database, lessonId: number): ReviewSummary | null {
  const row = db.prepare('SELECT total, correct, created_at AS createdAt, finished_at AS finishedAt FROM lesson_reviews WHERE lesson_id = ?').get(lessonId) as
    | ReviewSummary
    | undefined
  return row ? { ...row } : null
}

/** Guarda perguntas novas para a aula; a revisão anterior (e as respostas dela) sai. */
export function saveReviewQuestions(db: Database, lessonId: number, questions: QuestionInput[], now = Math.floor(Date.now() / 1000)): LessonReview {
  if (!questions.length) throw new Error('A revisão precisa de pelo menos uma pergunta')
  db.prepare(
    `INSERT INTO lesson_reviews (lesson_id, questions_json, answers_json, total, correct, created_at, finished_at) VALUES (?, ?, '[]', ?, NULL, ?, NULL)
     ON CONFLICT (lesson_id) DO UPDATE SET questions_json = excluded.questions_json, answers_json = '[]', total = excluded.total,
       correct = NULL, created_at = excluded.created_at, finished_at = NULL`
  ).run(lessonId, JSON.stringify(questions), questions.length, now)
  return getReview(db, lessonId)!
}

/**
 * Grava as respostas (uma por pergunta, `null` = sem resposta). Com todas respondidas, a revisão termina e o acerto
 * é calculado aqui, não pela interface. Lista vazia recomeça a mesma revisão.
 */
export function saveReviewAnswers(db: Database, lessonId: number, answers: unknown, now = Math.floor(Date.now() / 1000)): LessonReview {
  const review = getReview(db, lessonId)
  if (!review) throw new Error('Esta aula não tem revisão')
  const list = Array.isArray(answers) ? answers : []
  const clean = review.questions.map((q, i) => {
    const a = list[i] as QuestionAnswer | null | undefined
    return a && typeof a === 'object' && a.type === q.type && isAnswered(a) ? a : null
  })
  const done = clean.every((a) => a !== null)
  db.prepare('UPDATE lesson_reviews SET answers_json = ?, correct = ?, finished_at = ? WHERE lesson_id = ?').run(
    JSON.stringify(clean),
    done ? reviewScore(review.questions, clean) : null,
    done ? now : null,
    lessonId
  )
  return getReview(db, lessonId)!
}
