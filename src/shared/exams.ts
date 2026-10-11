import type { Grade, Question, QuestionAnswer, QuestionKey, QuestionOption, QuestionType } from './questions'

export type FeedbackMode = 'after_submit' | 'immediate'

export interface ExamSettings {
  timeLimitMin: number | null
  passPercent: number
  shuffleQuestions: boolean
  shuffleOptions: boolean
  allowBack: boolean
  feedback: FeedbackMode
}

export const DEFAULT_EXAM_SETTINGS: ExamSettings = {
  timeLimitMin: null,
  passPercent: 60,
  shuffleQuestions: true,
  shuffleOptions: true,
  allowBack: true,
  feedback: 'after_submit'
}

export type ExamSelection =
  | { mode: 'random'; count: number; topics: string[]; difficulties: number[] }
  | { mode: 'manual'; questionIds: number[] }

export interface Exam {
  id: number
  bankId: number
  title: string
  settings: ExamSettings
  selection: ExamSelection
  createdAt: number
  attemptCount: number
  bestPercent: number | null
  lastPercent: number | null
  inProgressAttemptId: number | null
}

export interface BankSummary {
  id: number
  title: string
  description: string
  questionCount: number
  examCount: number
  attemptCount: number
  lastPercent: number | null
}

/** Questão como aparece na prova: sem gabarito enquanto não deve ser revelado. */
export interface AttemptQuestion {
  id: number
  type: QuestionType
  statement: string
  options: QuestionOption[]
  topic: string
  points: number
  /** Só presentes quando a correção já pode ser mostrada. */
  key?: QuestionKey
  explanation?: string
}

export interface AttemptAnswerState {
  answer: QuestionAnswer | null
  marked: boolean
  /** Presente quando a correção pode ser mostrada (modo imediato ou prova enviada). */
  grade?: Grade
}

export interface AttemptView {
  id: number
  examId: number
  examTitle: string
  bankId: number
  status: 'in_progress' | 'submitted'
  startedAt: number
  submittedAt: number | null
  /** Segundos restantes, calculados no processo principal; `null` sem limite. */
  remainingSec: number | null
  settings: ExamSettings
  focusLosses: number
  questions: AttemptQuestion[]
  answers: Record<number, AttemptAnswerState>
  /** Só após o envio. */
  result: AttemptResult | null
}

export interface AttemptResult {
  score: number
  maxScore: number
  percent: number
  passed: boolean
  durationSec: number
  correctCount: number
  wrongCount: number
  pendingCount: number
}

export interface AttemptSummary {
  id: number
  examId: number
  examTitle: string
  status: 'in_progress' | 'submitted'
  startedAt: number
  submittedAt: number | null
  percent: number | null
  passed: boolean | null
  focusLosses: number
}

export interface BankAnalytics {
  attempts: AttemptSummary[]
  byTopic: { topic: string; answered: number; correct: number }[]
  hardest: { questionId: number; statement: string; answered: number; correct: number }[]
}

export interface QuestionFilter {
  topic?: string
  type?: QuestionType | ''
  text?: string
}

export type { Question }
