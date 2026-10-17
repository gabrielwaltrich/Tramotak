/**
 * Revisão pós-aula: ao concluir uma aula, 3 a 5 perguntas rápidas sobre o assunto, geradas pela IA só com o
 * conteúdo da aula (fala, legenda ou texto). Respostas erradas viram flashcards com um clique.
 */
import type { AiGenerateRequest } from './ai'
import { grade, type QuestionAnswer, type QuestionInput } from './questions'

export const REVIEW_COUNTS = [3, 4, 5] as const
export type ReviewCount = (typeof REVIEW_COUNTS)[number]

export interface ReviewSettings {
  /** Oferece a revisão ao concluir uma aula. */
  enabled: boolean
  count: ReviewCount
}

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = { enabled: true, count: 4 }

export function normalizeReviewSettings(raw: unknown): ReviewSettings {
  const r = (raw ?? {}) as Partial<ReviewSettings>
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_REVIEW_SETTINGS.enabled,
    count: REVIEW_COUNTS.includes(r.count as ReviewCount) ? (r.count as ReviewCount) : DEFAULT_REVIEW_SETTINGS.count
  }
}

/** Abaixo disso o material não dá para perguntas que valham a pena. */
export const REVIEW_MIN_CHARS = 200

/**
 * Pedido de geração da revisão: questões de múltipla escolha e de verdadeiro ou falso (corrigidas na hora, sem
 * digitar), sobre as ideias centrais. As regras de conteúdo e o filtro `aboutTheMedium` são os mesmos da geração.
 */
export function reviewRequest(material: string, count: ReviewCount): AiGenerateRequest {
  return {
    task: 'questions',
    title: '',
    text: material,
    count,
    questionTypes: ['single', 'truefalse'],
    instructions:
      'É uma revisão rápida logo depois de estudar o conteúdo: pergunte sobre as ideias centrais (o que mais vale lembrar), com dificuldade de 2 a 3, enunciados curtos e no máximo 4 alternativas.',
    webSearch: false
  }
}

/** Situação da revisão de uma aula, para a interface decidir o que oferecer. */
export interface ReviewStatus {
  enabled: boolean
  count: ReviewCount
  /** Há um provedor de IA escolhido. */
  ai: boolean
  /**
   * `ready`: há fala/legenda/texto suficiente; `transcribe`: vídeo sem material, mas dá para transcrever antes;
   * `none`: não há como revisar.
   */
  material: 'ready' | 'transcribe' | 'none'
  saved: ReviewSummary | null
}

export interface ReviewSummary {
  total: number
  /** `null` enquanto não terminou. */
  correct: number | null
  createdAt: number
  finishedAt: number | null
}

export interface LessonReview extends ReviewSummary {
  lessonId: number
  questions: QuestionInput[]
  /** Uma posição por questão; `null` = ainda sem resposta. */
  answers: (QuestionAnswer | null)[]
}

/** Quantas acertou (só conta as respondidas). */
export function reviewScore(questions: QuestionInput[], answers: (QuestionAnswer | null)[]): number {
  return questions.reduce((sum, q, i) => sum + (grade(q, answers[i]).correct === true ? 1 : 0), 0)
}

/** A resposta certa em texto, para o verso da carta. */
export function correctAnswerText(q: QuestionInput): string {
  switch (q.key.type) {
    case 'single': {
      const id = q.key.correct
      return q.options.find((o) => o.id === id)?.text ?? ''
    }
    case 'multiple': {
      const ids = new Set(q.key.correct)
      return q.options
        .filter((o) => ids.has(o.id))
        .map((o) => o.text)
        .join('; ')
    }
    case 'truefalse':
      return q.key.correct ? 'Verdadeiro' : 'Falso'
    case 'short':
      return q.key.accepted.join(' / ')
    case 'essay':
      return q.key.reference
  }
}

/** Carta a partir de uma questão errada: a frente é o enunciado; o verso, a resposta certa e a explicação. */
export function reviewCard(q: QuestionInput): { front: string; back: string } {
  const front = q.type === 'truefalse' ? `Verdadeiro ou falso? ${q.statement}` : q.statement
  const answer = correctAnswerText(q)
  return { front, back: q.explanation.trim() ? `${answer}\n\n${q.explanation.trim()}` : answer }
}
