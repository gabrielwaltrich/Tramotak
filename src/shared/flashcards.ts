import type { CardState, DeckOptions, Rating } from './srs'

export interface DeckSummary {
  id: number
  title: string
  description: string
  courseId: number | null
  courseTitle: string | null
  options: DeckOptions
  total: number
  /** Cartas novas liberadas hoje (respeitando o limite diário). */
  newCount: number
  /** Em aprendizado/reaprendizado e vencendo hoje. */
  learningCount: number
  /** Revisões vencendo até o fim de hoje (respeitando o limite diário). */
  reviewCount: number
}

export interface CardView {
  id: number
  deckId: number
  front: string
  back: string
  state: CardState
  due: number
  intervalDays: number
  /** Memória do FSRS (null em cartas novas). */
  stability: number | null
  difficulty: number | null
  lastReviewAt: number | null
  lessonId: number | null
  lessonTitle: string | null
  courseId: number | null
  timestampSec: number | null
}

export interface DeckDetail extends DeckSummary {
  cards: CardView[]
}

export interface StudyCard {
  card: CardView
  /** Segundos até a próxima revisão para cada resposta. */
  intervals: Record<Rating, number>
  counts: { newCount: number; learningCount: number; reviewCount: number }
}

export interface StudyNext {
  next: StudyCard | null
  /** Se só restam cartas em aprendizado para mais tarde hoje, quando a próxima vence. */
  nextLearningAt: number | null
}

export interface NewCard {
  deckId: number
  front: string
  back: string
  lessonId?: number | null
  timestampSec?: number | null
}

export interface ImportResult {
  deckId: number
  deckTitle: string
  imported: number
  skipped: number
}

export const MAX_CARD_FIELD = 10_000
