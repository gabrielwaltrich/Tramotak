/**
 * Gerar flashcards ou questões do curso inteiro (ou de alguns módulos): um pedido à IA por aula com material, salvando
 * direto no baralho ou banco escolhido, para revisar depois. Lógica pura e tipos.
 */
import type { AiQuestionType } from './ai'

export type CourseGenerateTask = 'cards' | 'questions'

export interface CourseGenerateRequest {
  courseId: number
  task: CourseGenerateTask
  /** Módulos escolhidos (com os submódulos); vazio = o curso inteiro. */
  moduleIds: number[]
  /** Itens por aula. */
  perLesson: number
  /** Teto do total (as últimas aulas ficam sem itens se ele acabar). */
  maxTotal: number
  questionTypes: AiQuestionType[]
  instructions: string
  /** Baralho ou banco existente, ou `null` para criar um com `newTitle`. */
  targetId: number | null
  newTitle: string
}

export const PER_LESSON_LIMITS = { min: 1, max: 10 }
export const MAX_TOTAL_LIMITS = { min: 1, max: 1000 }
export const DEFAULT_MAX_TOTAL = 300

/** Aulas com menos que isso de material não ganham itens (não dá para perguntar algo útil). */
export const MIN_LESSON_CHARS = 200

/** Quantos itens cada aula gera: `perLesson` até acabar o teto, na ordem do curso. */
export function planCounts<T extends { chars: number }>(lessons: T[], perLesson: number, maxTotal: number): (T & { count: number })[] {
  let left = maxTotal
  const out: (T & { count: number })[] = []
  for (const l of lessons) {
    if (l.chars < MIN_LESSON_CHARS || left <= 0) continue
    const count = Math.min(perLesson, left)
    left -= count
    out.push({ ...l, count })
  }
  return out
}

/** Estado de uma geração em andamento (vai para a interface a cada aula). */
export interface CourseGenerateProgress {
  task: CourseGenerateTask
  courseId: number
  /** Baralho ou banco onde os itens estão sendo salvos. */
  targetId: number | null
  targetTitle: string
  /** Aulas já processadas e o total do plano. */
  done: number
  total: number
  saved: number
  /** Itens descartados (repetidos ou falando do vídeo em vez do assunto). */
  discarded: number
  /** Aulas que deram erro (seguem as outras). */
  failed: number
  lastError: string | null
  finished: boolean
  canceled: boolean
  /** Erro que parou tudo (ex.: chave recusada). */
  error: string | null
}

/** Aulas e material disponíveis no escopo escolhido (para mostrar antes de gerar). */
export interface CourseMaterialSummary {
  /** Aulas do escopo com material suficiente. */
  lessons: number
  /** Aulas do escopo. */
  total: number
  chars: number
  modules: { id: number; title: string; lessons: number; withMaterial: number }[]
}

/** Erros passageiros do provedor (limite de uso, sobrecarga): vale esperar e tentar de novo. */
export const isTransientAiError = (message: string): boolean => /limite de uso|sobrecarregado|rate limit|429|503|529/i.test(message)
