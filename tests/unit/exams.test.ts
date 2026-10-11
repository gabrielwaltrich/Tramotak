import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { QuestionInput } from '@shared/questions'
import { openDatabase, type Database } from '../../src/main/db/database'
import {
  bankAnalytics,
  bankTopics,
  createBank,
  createExam,
  createQuestion,
  deleteBank,
  deleteQuestion,
  getAttempt,
  gradeEssay,
  listBanks,
  listExams,
  recordFocusLoss,
  saveAnswer,
  setMarked,
  startAttempt,
  submitAttempt,
  updateQuestion
} from '../../src/main/db/questions'
import { search } from '../../src/main/db/search'

let db: Database
let bankId: number
const t0 = 1_000_000
const first = () => 0 // shuffle determinístico

beforeEach(() => {
  db = openDatabase(':memory:')
  bankId = createBank(db, { title: 'Cálculo' })
})
afterEach(() => db.close())

const single = (statement: string, topic = 'Derivadas', difficulty = 3): QuestionInput => ({
  type: 'single',
  statement,
  options: [
    { id: 'a', text: 'certa' },
    { id: 'b', text: 'errada' }
  ],
  key: { type: 'single', correct: 'a' },
  explanation: 'porque sim',
  topic,
  difficulty,
  points: 1
})
const essay: QuestionInput = { type: 'essay', statement: 'Explique limite', options: [], key: { type: 'essay', reference: 'aproximação' }, explanation: '', topic: 'Limites', difficulty: 4, points: 2 }

function examWith(settings = {}, selection: Parameters<typeof createExam>[2]['selection'] = { mode: 'random', count: 10, topics: [], difficulties: [] }) {
  return createExam(db, bankId, { title: 'Simulado 1', settings: { shuffleQuestions: false, shuffleOptions: false, ...settings }, selection })
}

describe('bancos e questões', () => {
  it('cria, conta, lista tópicos, edita e entra na busca', () => {
    const q = createQuestion(db, bankId, single('Derivada de x²?'))
    createQuestion(db, bankId, essay)
    expect(listBanks(db)[0]).toMatchObject({ title: 'Cálculo', questionCount: 2, examCount: 0, lastPercent: null })
    expect(bankTopics(db, bankId)).toEqual(['Derivadas', 'Limites'])
    expect(updateQuestion(db, q.id, { ...single('Derivada de x³?'), difficulty: 5 })).toMatchObject({ statement: 'Derivada de x³?', difficulty: 5 })
    expect(search(db, 'derivada').map((h) => h.kind)).toContain('question')
  })

  it('excluir o banco apaga questões, simulados e tentativas', () => {
    createQuestion(db, bankId, single('a'))
    const exam = examWith()
    startAttempt(db, exam, t0, first)
    deleteBank(db, bankId)
    for (const t of ['questions', 'exams', 'attempts', 'attempt_answers']) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n, t).toBe(0)
    }
  })

  it('valida as configurações do simulado', () => {
    expect(() => examWith({ timeLimitMin: 0 })).toThrow('Tempo limite')
    expect(() => examWith({ passPercent: 120 })).toThrow('Nota de corte')
    expect(() => examWith({}, { mode: 'manual', questionIds: [] })).toThrow('pelo menos uma')
  })
})

describe('tentativas', () => {
  it('sorteio respeita tópico, dificuldade e quantidade; manual respeita a escolha', () => {
    const ids = [single('d1', 'Derivadas', 2), single('d2', 'Derivadas', 4), single('l1', 'Limites', 2)].map((q) => createQuestion(db, bankId, q).id)
    const byTopic = startAttempt(db, examWith({}, { mode: 'random', count: 5, topics: ['Derivadas'], difficulties: [] }), t0, first)
    expect(getAttempt(db, byTopic, t0).questions.map((q) => q.statement)).toEqual(['d1', 'd2'])
    const byDiff = startAttempt(db, examWith({}, { mode: 'random', count: 1, topics: [], difficulties: [2] }), t0, first)
    expect(getAttempt(db, byDiff, t0).questions).toHaveLength(1)
    const manual = startAttempt(db, examWith({}, { mode: 'manual', questionIds: [ids[2], ids[0]] }), t0, first)
    expect(getAttempt(db, manual, t0).questions.map((q) => q.statement)).toEqual(['l1', 'd1'])
    expect(() => startAttempt(db, examWith({}, { mode: 'random', count: 1, topics: ['Integrais'], difficulties: [] }), t0)).toThrow('Nenhuma questão')
  })

  it('não revela gabarito durante a prova; corrige ao enviar; nota e aprovação', () => {
    createQuestion(db, bankId, single('q1'))
    createQuestion(db, bankId, single('q2'))
    createQuestion(db, bankId, single('q3'))
    const exam = examWith({ passPercent: 60 })
    const id = startAttempt(db, exam, t0, first)
    expect(startAttempt(db, exam, t0)).toBe(id) // retoma a que está aberta

    const during = getAttempt(db, id, t0)
    expect(during.questions[0]).not.toHaveProperty('key')
    expect(during.questions[0]).not.toHaveProperty('explanation')
    const [q1, q2] = during.questions
    expect(saveAnswer(db, id, q1.id, { type: 'single', choice: 'a' }, t0 + 10)).toEqual({ answer: { type: 'single', choice: 'a' }, marked: false })
    saveAnswer(db, id, q2.id, { type: 'single', choice: 'a' }, t0 + 20)
    saveAnswer(db, id, q2.id, { type: 'single', choice: 'b' }, t0 + 25) // pode mudar (modo após envio)
    setMarked(db, id, q2.id, true)
    expect(getAttempt(db, id, t0 + 30).answers[q2.id]).toMatchObject({ marked: true })
    expect(getAttempt(db, id, t0 + 30).answers[q2.id]).not.toHaveProperty('grade')

    submitAttempt(db, id, t0 + 60)
    const after = getAttempt(db, id, t0 + 100)
    expect(after.result).toEqual({ score: 1, maxScore: 3, percent: 33.3, passed: false, durationSec: 60, correctCount: 1, wrongCount: 2, pendingCount: 0 })
    expect(after.questions[0]).toMatchObject({ key: { type: 'single', correct: 'a' }, explanation: 'porque sim' })
    expect(after.answers[q1.id].grade).toEqual({ correct: true, points: 1 })
    expect(() => saveAnswer(db, id, q1.id, null, t0 + 100)).toThrow('já foi enviada')
    expect(listExams(db, bankId)[0]).toMatchObject({ attemptCount: 1, bestPercent: 33.3, lastPercent: 33.3, inProgressAttemptId: null })
  })

  it('modo imediato mostra a correção na hora e trava a questão', () => {
    createQuestion(db, bankId, single('q1'))
    const id = startAttempt(db, examWith({ feedback: 'immediate' }), t0, first)
    const qid = getAttempt(db, id, t0).questions[0].id
    expect(saveAnswer(db, id, qid, { type: 'single', choice: 'b' }, t0 + 5).grade).toEqual({ correct: false, points: 0 })
    expect(getAttempt(db, id, t0 + 6).questions[0]).toHaveProperty('explanation', 'porque sim')
    expect(() => saveAnswer(db, id, qid, { type: 'single', choice: 'a' }, t0 + 7)).toThrow('já foi respondida')
  })

  it('o tempo é validado aqui: depois do limite a prova fecha sozinha', () => {
    createQuestion(db, bankId, single('q1'))
    createQuestion(db, bankId, single('q2'))
    const id = startAttempt(db, examWith({ timeLimitMin: 1 }), t0, first)
    const [q1, q2] = getAttempt(db, id, t0).questions
    expect(getAttempt(db, id, t0 + 20).remainingSec).toBe(40)
    saveAnswer(db, id, q1.id, { type: 'single', choice: 'a' }, t0 + 30)
    saveAnswer(db, id, q2.id, { type: 'single', choice: 'a' }, t0 + 63) // dentro da folga de 5 s
    expect(() => saveAnswer(db, id, q2.id, { type: 'single', choice: 'b' }, t0 + 70)).toThrow('Tempo esgotado')
    const view = getAttempt(db, id, t0 + 200)
    expect(view.status).toBe('submitted')
    expect(view.result).toMatchObject({ score: 2, durationSec: 60 }) // conta só até o fim do tempo
  })

  it('dissertativa fica pendente até a correção manual', () => {
    createQuestion(db, bankId, essay)
    const id = startAttempt(db, examWith(), t0, first)
    const qid = getAttempt(db, id, t0).questions[0].id
    saveAnswer(db, id, qid, { type: 'essay', text: 'é quando se aproxima' }, t0 + 5)
    expect(() => gradeEssay(db, id, qid, true)).toThrow('depois de enviar')
    submitAttempt(db, id, t0 + 10)
    expect(getAttempt(db, id).result).toMatchObject({ score: 0, pendingCount: 1 })
    gradeEssay(db, id, qid, true)
    expect(getAttempt(db, id).result).toMatchObject({ score: 2, percent: 100, passed: true, pendingCount: 0 })
  })

  it('editar ou excluir a questão depois não muda a prova já feita', () => {
    const q = createQuestion(db, bankId, single('original'))
    const id = startAttempt(db, examWith(), t0, first)
    saveAnswer(db, id, q.id, { type: 'single', choice: 'a' }, t0 + 1)
    submitAttempt(db, id, t0 + 2)
    updateQuestion(db, q.id, { ...single('editada'), key: { type: 'single', correct: 'b' } })
    deleteQuestion(db, q.id)
    const view = getAttempt(db, id)
    expect(view.questions[0].statement).toBe('original')
    expect(view.result?.percent).toBe(100)
  })

  it('anti-cola conta saídas da janela só durante a prova', () => {
    createQuestion(db, bankId, single('q1'))
    const id = startAttempt(db, examWith(), t0, first)
    expect(recordFocusLoss(db, id)).toBe(1)
    expect(recordFocusLoss(db, id)).toBe(2)
    submitAttempt(db, id, t0 + 1)
    expect(recordFocusLoss(db, id)).toBe(2)
  })
})

describe('desempenho', () => {
  it('acerto por tópico (pior primeiro) e questões mais erradas', () => {
    const d = createQuestion(db, bankId, single('derivada', 'Derivadas'))
    const l = createQuestion(db, bankId, single('limite', 'Limites'))
    const exam = examWith()
    for (const [choiceD, choiceL, at] of [['a', 'b', t0], ['a', 'b', t0 + 100], ['b', 'a', t0 + 200]] as const) {
      const id = startAttempt(db, exam, at, first)
      saveAnswer(db, id, d.id, { type: 'single', choice: choiceD }, at + 1)
      saveAnswer(db, id, l.id, { type: 'single', choice: choiceL }, at + 1)
      submitAttempt(db, id, at + 2)
    }
    const a = bankAnalytics(db, bankId)
    expect(a.attempts.map((x) => x.percent)).toEqual([50, 50, 50])
    expect(a.byTopic).toEqual([
      { topic: 'Limites', answered: 3, correct: 1 },
      { topic: 'Derivadas', answered: 3, correct: 2 }
    ])
    expect(a.hardest.map((h) => h.statement)).toEqual(['limite', 'derivada'])
  })
})
