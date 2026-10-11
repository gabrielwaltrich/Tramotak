import {
  DEFAULT_EXAM_SETTINGS,
  type AttemptAnswerState,
  type AttemptQuestion,
  type AttemptResult,
  type AttemptSummary,
  type AttemptView,
  type BankAnalytics,
  type BankSummary,
  type Exam,
  type ExamSelection,
  type ExamSettings
} from '@shared/exams'
import { grade, shuffle, validateQuestion, type Question, type QuestionAnswer, type QuestionInput } from '@shared/questions'
import { transaction, type Database } from './database'

/** Folga para a última resposta chegar depois do fim do tempo (latência da interface). */
const TIME_GRACE_SEC = 5
const nowSec = () => Math.floor(Date.now() / 1000)

function cleanTitle(value: unknown, what: string): string {
  const title = String(value ?? '').trim()
  if (!title) throw new Error(`O nome do ${what} não pode ficar vazio`)
  return title.slice(0, 200)
}

// ── Bancos ──────────────────────────────────────────────────────────────────

export function listBanks(db: Database): BankSummary[] {
  const rows = db
    .prepare(
      `SELECT b.id, b.title, b.description,
              (SELECT COUNT(*) FROM questions q WHERE q.bank_id = b.id) AS questionCount,
              (SELECT COUNT(*) FROM exams e WHERE e.bank_id = b.id) AS examCount,
              (SELECT COUNT(*) FROM attempts a JOIN exams e ON e.id = a.exam_id WHERE e.bank_id = b.id AND a.status = 'submitted') AS attemptCount,
              (SELECT a.score * 100.0 / a.max_score FROM attempts a JOIN exams e ON e.id = a.exam_id
                WHERE e.bank_id = b.id AND a.status = 'submitted' AND a.max_score > 0 ORDER BY a.submitted_at DESC LIMIT 1) AS lastPercent
         FROM question_banks b ORDER BY b.updated_at DESC, b.id DESC`
    )
    .all() as unknown as BankSummary[]
  return rows
}

export function getBank(db: Database, id: number): BankSummary {
  const bank = listBanks(db).find((b) => b.id === id)
  if (!bank) throw new Error('Banco de questões não encontrado')
  return bank
}

export function createBank(db: Database, input: { title: string; description?: string }): number {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO question_banks (title, description) VALUES (?, ?)')
    .run(cleanTitle(input.title, 'banco'), String(input.description ?? '').trim())
  return Number(lastInsertRowid)
}

export function updateBank(db: Database, id: number, patch: { title: string; description: string }): void {
  const { changes } = db
    .prepare('UPDATE question_banks SET title = ?, description = ?, updated_at = unixepoch() WHERE id = ?')
    .run(cleanTitle(patch.title, 'banco'), String(patch.description ?? '').trim(), id)
  if (!changes) throw new Error('Banco de questões não encontrado')
}

export function deleteBank(db: Database, id: number): void {
  db.prepare('DELETE FROM question_banks WHERE id = ?').run(id)
}

const touchBank = (db: Database, bankId: number) =>
  db.prepare('UPDATE question_banks SET updated_at = unixepoch() WHERE id = ?').run(bankId)

// ── Questões ────────────────────────────────────────────────────────────────

interface QuestionRow {
  id: number
  bankId: number
  type: Question['type']
  statement: string
  options: string
  key: string
  explanation: string
  topic: string
  difficulty: number
  points: number
  createdAt: number
  updatedAt: number
}

const QUESTION_SELECT = `SELECT id, bank_id AS bankId, type, statement, options_json AS options, key_json AS key,
  explanation, topic, difficulty, points, created_at AS createdAt, updated_at AS updatedAt FROM questions`

function toQuestion(row: QuestionRow): Question {
  return { ...row, options: JSON.parse(row.options), key: JSON.parse(row.key) }
}

export function listQuestions(db: Database, bankId: number): Question[] {
  return (db.prepare(`${QUESTION_SELECT} WHERE bank_id = ? ORDER BY id`).all(bankId) as unknown as QuestionRow[]).map(toQuestion)
}

export function getQuestion(db: Database, id: number): Question {
  const row = db.prepare(`${QUESTION_SELECT} WHERE id = ?`).get(id) as unknown as QuestionRow | undefined
  if (!row) throw new Error('Questão não encontrada')
  return toQuestion(row)
}

export function createQuestion(db: Database, bankId: number, input: QuestionInput): Question {
  getBank(db, bankId)
  const q = validateQuestion(input)
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO questions (bank_id, type, statement, options_json, key_json, explanation, topic, difficulty, points)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(bankId, q.type, q.statement, JSON.stringify(q.options), JSON.stringify(q.key), q.explanation, q.topic, q.difficulty, q.points)
  touchBank(db, bankId)
  return getQuestion(db, Number(lastInsertRowid))
}

export function updateQuestion(db: Database, id: number, input: QuestionInput): Question {
  const q = validateQuestion(input)
  const { changes } = db
    .prepare(
      `UPDATE questions SET type = ?, statement = ?, options_json = ?, key_json = ?, explanation = ?, topic = ?,
         difficulty = ?, points = ?, updated_at = unixepoch() WHERE id = ?`
    )
    .run(q.type, q.statement, JSON.stringify(q.options), JSON.stringify(q.key), q.explanation, q.topic, q.difficulty, q.points, id)
  if (!changes) throw new Error('Questão não encontrada')
  return getQuestion(db, id)
}

export function deleteQuestion(db: Database, id: number): void {
  db.prepare('DELETE FROM questions WHERE id = ?').run(id)
}

export function bankTopics(db: Database, bankId: number): string[] {
  return (db.prepare("SELECT DISTINCT topic FROM questions WHERE bank_id = ? AND topic != '' ORDER BY topic").all(bankId) as { topic: string }[]).map(
    (r) => r.topic
  )
}

// ── Simulados ───────────────────────────────────────────────────────────────

function cleanSettings(input: Partial<ExamSettings> | undefined): ExamSettings {
  const s = { ...DEFAULT_EXAM_SETTINGS, ...input }
  const limit = s.timeLimitMin === null || s.timeLimitMin === undefined || String(s.timeLimitMin) === '' ? null : Number(s.timeLimitMin)
  if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 600)) throw new Error('Tempo limite deve ficar entre 1 e 600 minutos')
  const pass = Number(s.passPercent)
  if (!Number.isFinite(pass) || pass < 0 || pass > 100) throw new Error('Nota de corte deve ficar entre 0% e 100%')
  return {
    timeLimitMin: limit,
    passPercent: Math.round(pass),
    shuffleQuestions: Boolean(s.shuffleQuestions),
    shuffleOptions: Boolean(s.shuffleOptions),
    allowBack: Boolean(s.allowBack),
    feedback: s.feedback === 'immediate' ? 'immediate' : 'after_submit'
  }
}

function cleanSelection(input: ExamSelection): ExamSelection {
  if (input?.mode === 'manual') {
    const ids = [...new Set((input.questionIds ?? []).filter(Number.isInteger))]
    if (ids.length === 0) throw new Error('Escolha pelo menos uma questão')
    return { mode: 'manual', questionIds: ids }
  }
  const count = Number(input?.count)
  if (!Number.isInteger(count) || count < 1 || count > 500) throw new Error('Quantidade de questões deve ficar entre 1 e 500')
  return {
    mode: 'random',
    count,
    topics: [...new Set((input?.topics ?? []).map(String))],
    difficulties: [...new Set((input?.difficulties ?? []).map(Number).filter((d) => d >= 1 && d <= 5))]
  }
}

interface ExamRow {
  id: number
  bankId: number
  title: string
  settings: string
  selection: string
  createdAt: number
}

function percentOf(score: number | null, max: number): number | null {
  return score === null || max <= 0 ? null : Math.round((score / max) * 1000) / 10
}

export function listExams(db: Database, bankId: number): Exam[] {
  const rows = db
    .prepare('SELECT id, bank_id AS bankId, title, settings_json AS settings, selection_json AS selection, created_at AS createdAt FROM exams WHERE bank_id = ? ORDER BY id DESC')
    .all(bankId) as unknown as ExamRow[]
  return rows.map((r) => {
    const attempts = db
      .prepare('SELECT id, status, score, max_score AS maxScore FROM attempts WHERE exam_id = ? ORDER BY started_at DESC, id DESC')
      .all(r.id) as { id: number; status: string; score: number | null; maxScore: number }[]
    const done = attempts.filter((a) => a.status === 'submitted').map((a) => percentOf(a.score, a.maxScore) ?? 0)
    return {
      id: r.id,
      bankId: r.bankId,
      title: r.title,
      createdAt: r.createdAt,
      settings: JSON.parse(r.settings),
      selection: JSON.parse(r.selection),
      attemptCount: done.length,
      bestPercent: done.length ? Math.max(...done) : null,
      lastPercent: done[0] ?? null,
      inProgressAttemptId: attempts.find((a) => a.status === 'in_progress')?.id ?? null
    }
  })
}

export function createExam(db: Database, bankId: number, input: { title: string; settings?: Partial<ExamSettings>; selection: ExamSelection }): number {
  getBank(db, bankId)
  const { lastInsertRowid } = db
    .prepare('INSERT INTO exams (bank_id, title, settings_json, selection_json) VALUES (?, ?, ?, ?)')
    .run(bankId, cleanTitle(input.title, 'simulado'), JSON.stringify(cleanSettings(input.settings)), JSON.stringify(cleanSelection(input.selection)))
  touchBank(db, bankId)
  return Number(lastInsertRowid)
}

export function deleteExam(db: Database, id: number): void {
  db.prepare('DELETE FROM exams WHERE id = ?').run(id)
}

// ── Tentativas ──────────────────────────────────────────────────────────────

interface AttemptRow {
  id: number
  examId: number
  examTitle: string
  bankId: number
  status: 'in_progress' | 'submitted'
  startedAt: number
  submittedAt: number | null
  timeLimitSec: number | null
  settings: string
  questions: string
  score: number | null
  maxScore: number
  focusLosses: number
}

const ATTEMPT_SELECT = `SELECT a.id, a.exam_id AS examId, e.title AS examTitle, e.bank_id AS bankId, a.status,
  a.started_at AS startedAt, a.submitted_at AS submittedAt, a.time_limit_sec AS timeLimitSec,
  a.settings_json AS settings, a.questions_json AS questions, a.score, a.max_score AS maxScore, a.focus_losses AS focusLosses
  FROM attempts a JOIN exams e ON e.id = a.exam_id`

function getAttemptRow(db: Database, id: number): AttemptRow {
  const row = db.prepare(`${ATTEMPT_SELECT} WHERE a.id = ?`).get(id) as unknown as AttemptRow | undefined
  if (!row) throw new Error('Tentativa não encontrada')
  return row
}

/** Sorteia (ou pega as escolhidas) e congela as questões da prova. */
export function startAttempt(db: Database, examId: number, now = nowSec(), random: () => number = Math.random): number {
  const exam = db.prepare('SELECT id, bank_id AS bankId, settings_json AS settings, selection_json AS selection FROM exams WHERE id = ?').get(examId) as
    | { id: number; bankId: number; settings: string; selection: string }
    | undefined
  if (!exam) throw new Error('Simulado não encontrado')
  const open = db.prepare("SELECT id FROM attempts WHERE exam_id = ? AND status = 'in_progress'").get(examId) as { id: number } | undefined
  if (open) return open.id

  const settings: ExamSettings = JSON.parse(exam.settings)
  const selection: ExamSelection = JSON.parse(exam.selection)
  const all = listQuestions(db, exam.bankId)
  let picked: Question[]
  if (selection.mode === 'manual') {
    const byId = new Map(all.map((q) => [q.id, q]))
    picked = selection.questionIds.map((id) => byId.get(id)).filter((q): q is Question => q !== undefined)
    if (settings.shuffleQuestions) picked = shuffle(picked, random)
  } else {
    const pool = all.filter(
      (q) =>
        (selection.topics.length === 0 || selection.topics.includes(q.topic)) &&
        (selection.difficulties.length === 0 || selection.difficulties.includes(q.difficulty))
    )
    picked = shuffle(pool, random).slice(0, selection.count)
    if (!settings.shuffleQuestions) picked.sort((a, b) => a.id - b.id)
  }
  if (picked.length === 0) throw new Error('Nenhuma questão do banco atende aos critérios deste simulado')

  const snapshot = picked.map((q) => ({
    id: q.id,
    type: q.type,
    statement: q.statement,
    options: settings.shuffleOptions ? shuffle(q.options, random) : q.options,
    topic: q.topic,
    points: q.points,
    key: q.key,
    explanation: q.explanation
  }))
  const maxScore = snapshot.reduce((n, q) => n + q.points, 0)

  return transaction(db, () => {
    const id = Number(
      db
        .prepare('INSERT INTO attempts (exam_id, started_at, time_limit_sec, settings_json, questions_json, max_score) VALUES (?, ?, ?, ?, ?, ?)')
        .run(examId, now, settings.timeLimitMin ? settings.timeLimitMin * 60 : null, JSON.stringify(settings), JSON.stringify(snapshot), maxScore).lastInsertRowid
    )
    const insert = db.prepare('INSERT INTO attempt_answers (attempt_id, question_id) VALUES (?, ?)')
    for (const q of snapshot) insert.run(id, q.id)
    return id
  })
}

type Snapshot = Required<AttemptQuestion>

function expired(row: AttemptRow, now: number, grace = 0): boolean {
  return row.status === 'in_progress' && row.timeLimitSec !== null && now > row.startedAt + row.timeLimitSec + grace
}

/** Soma as notas e fecha a tentativa. Questões sem resposta valem zero. */
export function submitAttempt(db: Database, attemptId: number, now = nowSec()): void {
  const row = getAttemptRow(db, attemptId)
  if (row.status === 'submitted') return
  const end = row.timeLimitSec !== null ? Math.min(now, row.startedAt + row.timeLimitSec) : now
  transaction(db, () => {
    // Em branco conta como errada (só dissertativas respondidas ficam pendentes de correção).
    db.prepare('UPDATE attempt_answers SET correct = 0, points = 0 WHERE attempt_id = ? AND answer_json IS NULL').run(attemptId)
    const score = (db.prepare('SELECT COALESCE(SUM(points), 0) AS s FROM attempt_answers WHERE attempt_id = ?').get(attemptId) as { s: number }).s
    db.prepare("UPDATE attempts SET status = 'submitted', submitted_at = ?, score = ? WHERE id = ?").run(end, score, attemptId)
  })
}

/** Grava a resposta (e a correção, guardada desde já). Recusa depois do tempo ou de enviada. */
export function saveAnswer(db: Database, attemptId: number, questionId: number, answer: QuestionAnswer | null, now = nowSec()): AttemptAnswerState {
  const row = getAttemptRow(db, attemptId)
  if (row.status === 'submitted') throw new Error('Esta prova já foi enviada')
  if (expired(row, now, TIME_GRACE_SEC)) {
    submitAttempt(db, attemptId, now)
    throw new Error('Tempo esgotado: a prova foi enviada')
  }
  const questions: Snapshot[] = JSON.parse(row.questions)
  const question = questions.find((q) => q.id === questionId)
  if (!question) throw new Error('Questão fora desta prova')
  const settings: ExamSettings = JSON.parse(row.settings)

  const current = db.prepare('SELECT answer_json AS answer, marked FROM attempt_answers WHERE attempt_id = ? AND question_id = ?').get(attemptId, questionId) as {
    answer: string | null
    marked: number
  }
  // No modo de correção imediata, a primeira resposta trava a questão.
  if (settings.feedback === 'immediate' && current.answer !== null) throw new Error('Esta questão já foi respondida')

  const result = grade(question, answer)
  db.prepare('UPDATE attempt_answers SET answer_json = ?, correct = ?, points = ?, answered_at = ? WHERE attempt_id = ? AND question_id = ?').run(
    answer === null ? null : JSON.stringify(answer),
    result.correct === null ? null : result.correct ? 1 : 0,
    result.points,
    now,
    attemptId,
    questionId
  )
  return { answer, marked: Boolean(current.marked), ...(settings.feedback === 'immediate' && answer !== null ? { grade: result } : {}) }
}

export function setMarked(db: Database, attemptId: number, questionId: number, marked: boolean): void {
  const row = getAttemptRow(db, attemptId)
  if (row.status === 'submitted') throw new Error('Esta prova já foi enviada')
  db.prepare('UPDATE attempt_answers SET marked = ? WHERE attempt_id = ? AND question_id = ?').run(marked ? 1 : 0, attemptId, questionId)
}

/** Anti-cola: cada saída da janela durante a prova fica registrada. */
export function recordFocusLoss(db: Database, attemptId: number): number {
  db.prepare("UPDATE attempts SET focus_losses = focus_losses + 1 WHERE id = ? AND status = 'in_progress'").run(attemptId)
  return getAttemptRow(db, attemptId).focusLosses
}

/** Correção manual de dissertativa depois do envio. */
export function gradeEssay(db: Database, attemptId: number, questionId: number, correct: boolean): void {
  const row = getAttemptRow(db, attemptId)
  if (row.status !== 'submitted') throw new Error('Corrija depois de enviar a prova')
  const question = (JSON.parse(row.questions) as Snapshot[]).find((q) => q.id === questionId)
  if (!question || question.type !== 'essay') throw new Error('Só dissertativas são corrigidas manualmente')
  transaction(db, () => {
    db.prepare('UPDATE attempt_answers SET correct = ?, points = ? WHERE attempt_id = ? AND question_id = ?').run(
      correct ? 1 : 0, correct ? question.points : 0, attemptId, questionId
    )
    const score = (db.prepare('SELECT COALESCE(SUM(points), 0) AS s FROM attempt_answers WHERE attempt_id = ?').get(attemptId) as { s: number }).s
    db.prepare('UPDATE attempts SET score = ? WHERE id = ?').run(score, attemptId)
  })
}

/**
 * Estado da tentativa para a interface. Fecha sozinha se o tempo acabou.
 * Enquanto em andamento, gabarito e explicação só aparecem nas questões já corrigidas no modo imediato.
 */
export function getAttempt(db: Database, attemptId: number, now = nowSec()): AttemptView {
  let row = getAttemptRow(db, attemptId)
  if (expired(row, now)) {
    submitAttempt(db, attemptId, now)
    row = getAttemptRow(db, attemptId)
  }
  const settings: ExamSettings = JSON.parse(row.settings)
  const snapshot: Snapshot[] = JSON.parse(row.questions)
  const submitted = row.status === 'submitted'
  const answerRows = db
    .prepare('SELECT question_id AS questionId, answer_json AS answer, marked, correct, points FROM attempt_answers WHERE attempt_id = ?')
    .all(attemptId) as { questionId: number; answer: string | null; marked: number; correct: number | null; points: number }[]

  const answers: Record<number, AttemptAnswerState> = {}
  const revealed = new Set<number>()
  for (const a of answerRows) {
    const answer = a.answer === null ? null : (JSON.parse(a.answer) as QuestionAnswer)
    const show = submitted || (settings.feedback === 'immediate' && answer !== null)
    if (show) revealed.add(a.questionId)
    answers[a.questionId] = {
      answer,
      marked: Boolean(a.marked),
      ...(show ? { grade: { correct: a.correct === null ? null : a.correct === 1, points: a.points } } : {})
    }
  }

  const questions: AttemptQuestion[] = snapshot.map(({ key, explanation, ...q }) => (revealed.has(q.id) ? { ...q, key, explanation } : q))

  let result: AttemptResult | null = null
  if (submitted) {
    const grades = Object.values(answers).map((a) => a.grade)
    const percent = percentOf(row.score, row.maxScore) ?? 0
    result = {
      score: row.score ?? 0,
      maxScore: row.maxScore,
      percent,
      passed: percent >= settings.passPercent,
      durationSec: (row.submittedAt ?? now) - row.startedAt,
      correctCount: grades.filter((g) => g?.correct === true).length,
      wrongCount: grades.filter((g) => g?.correct === false).length,
      pendingCount: grades.filter((g) => g?.correct === null).length
    }
  }

  return {
    id: row.id,
    examId: row.examId,
    examTitle: row.examTitle,
    bankId: row.bankId,
    status: row.status,
    startedAt: row.startedAt,
    submittedAt: row.submittedAt,
    remainingSec: row.status === 'in_progress' && row.timeLimitSec !== null ? Math.max(0, row.startedAt + row.timeLimitSec - now) : null,
    settings,
    focusLosses: row.focusLosses,
    questions,
    answers,
    result
  }
}

export function deleteAttempt(db: Database, attemptId: number): void {
  db.prepare('DELETE FROM attempts WHERE id = ?').run(attemptId)
}

// ── Desempenho ──────────────────────────────────────────────────────────────

export function bankAnalytics(db: Database, bankId: number): BankAnalytics {
  const rows = db.prepare(`${ATTEMPT_SELECT} WHERE e.bank_id = ? ORDER BY a.started_at DESC, a.id DESC`).all(bankId) as unknown as AttemptRow[]
  const attempts: AttemptSummary[] = rows.map((r) => {
    const percent = r.status === 'submitted' ? percentOf(r.score, r.maxScore) : null
    return {
      id: r.id,
      examId: r.examId,
      examTitle: r.examTitle,
      status: r.status,
      startedAt: r.startedAt,
      submittedAt: r.submittedAt,
      percent,
      passed: percent === null ? null : percent >= (JSON.parse(r.settings) as ExamSettings).passPercent,
      focusLosses: r.focusLosses
    }
  })

  const topics = new Map<string, { answered: number; correct: number }>()
  const perQuestion = new Map<number, { statement: string; answered: number; correct: number }>()
  for (const r of rows.filter((x) => x.status === 'submitted')) {
    const snapshot = new Map((JSON.parse(r.questions) as Snapshot[]).map((q) => [q.id, q]))
    const answers = db.prepare('SELECT question_id AS questionId, correct FROM attempt_answers WHERE attempt_id = ? AND correct IS NOT NULL').all(r.id) as {
      questionId: number
      correct: number
    }[]
    for (const a of answers) {
      const q = snapshot.get(a.questionId)
      if (!q) continue
      const topicKey = q.topic || 'Sem tópico'
      const t = topics.get(topicKey) ?? { answered: 0, correct: 0 }
      t.answered++
      t.correct += a.correct
      topics.set(topicKey, t)
      const p = perQuestion.get(q.id) ?? { statement: q.statement, answered: 0, correct: 0 }
      p.answered++
      p.correct += a.correct
      perQuestion.set(q.id, p)
    }
  }

  return {
    attempts,
    byTopic: [...topics].map(([topic, v]) => ({ topic, ...v })).sort((a, b) => a.correct / a.answered - b.correct / b.answered),
    hardest: [...perQuestion]
      .map(([questionId, v]) => ({ questionId, ...v }))
      .filter((q) => q.correct < q.answered)
      .sort((a, b) => a.correct / a.answered - b.correct / b.answered || b.answered - a.answered)
      .slice(0, 10)
  }
}
