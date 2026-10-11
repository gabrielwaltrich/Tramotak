import { normalize } from './search'

export type QuestionType = 'single' | 'multiple' | 'truefalse' | 'short' | 'essay'

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  single: 'Múltipla escolha',
  multiple: 'Múltipla resposta',
  truefalse: 'Verdadeiro ou falso',
  short: 'Resposta curta',
  essay: 'Dissertativa'
}

export interface QuestionOption {
  id: string
  text: string
}

/** Gabarito de cada tipo. */
export type QuestionKey =
  | { type: 'single'; correct: string }
  | { type: 'multiple'; correct: string[] }
  | { type: 'truefalse'; correct: boolean }
  | { type: 'short'; accepted: string[] }
  | { type: 'essay'; reference: string }

/** Resposta dada numa tentativa. */
export type QuestionAnswer =
  | { type: 'single'; choice: string | null }
  | { type: 'multiple'; choices: string[] }
  | { type: 'truefalse'; value: boolean | null }
  | { type: 'short'; text: string }
  | { type: 'essay'; text: string }

export interface QuestionInput {
  type: QuestionType
  statement: string
  options: QuestionOption[]
  key: QuestionKey
  explanation: string
  topic: string
  difficulty: number
  points: number
}

export interface Question extends QuestionInput {
  id: number
  bankId: number
  createdAt: number
  updatedAt: number
}

export interface Grade {
  /** `null` = aguardando correção manual (dissertativa). */
  correct: boolean | null
  points: number
}

/** Texto para comparar respostas curtas: sem acento, minúsculo, espaços normalizados. */
export function normalizeShort(text: string): string {
  return normalize(text).replace(/\s+/g, ' ').trim()
}

export function isAnswered(answer: QuestionAnswer | null | undefined): boolean {
  if (!answer) return false
  switch (answer.type) {
    case 'single':
      return answer.choice !== null
    case 'multiple':
      return answer.choices.length > 0
    case 'truefalse':
      return answer.value !== null
    case 'short':
    case 'essay':
      return answer.text.trim() !== ''
  }
}

/** Corrige uma resposta. Múltipla resposta é tudo ou nada; dissertativa fica pendente. */
export function grade(question: Pick<Question, 'key' | 'points'>, answer: QuestionAnswer | null | undefined): Grade {
  const { key, points } = question
  const wrong: Grade = { correct: false, points: 0 }
  const right: Grade = { correct: true, points }
  if (key.type === 'essay') return isAnswered(answer) ? { correct: null, points: 0 } : wrong
  if (!answer || answer.type !== key.type || !isAnswered(answer)) return wrong

  switch (key.type) {
    case 'single':
      return (answer as { choice: string }).choice === key.correct ? right : wrong
    case 'multiple': {
      const chosen = new Set((answer as { choices: string[] }).choices)
      return chosen.size === key.correct.length && key.correct.every((id) => chosen.has(id)) ? right : wrong
    }
    case 'truefalse':
      return (answer as { value: boolean }).value === key.correct ? right : wrong
    case 'short': {
      const given = normalizeShort((answer as { text: string }).text)
      return key.accepted.some((a) => normalizeShort(a) === given) ? right : wrong
    }
  }
}

const MAX_TEXT = 20_000

/** Valida e limpa uma questão vinda da interface ou de um arquivo importado. */
export function validateQuestion(input: QuestionInput): QuestionInput {
  const statement = String(input.statement ?? '').trim()
  if (!statement) throw new Error('O enunciado não pode ficar vazio')
  if (statement.length > MAX_TEXT) throw new Error('Enunciado longo demais')
  const type = input.type
  if (!(type in QUESTION_TYPE_LABEL)) throw new Error('Tipo de questão inválido')

  const base = {
    type,
    statement,
    explanation: String(input.explanation ?? '').trim().slice(0, MAX_TEXT),
    topic: String(input.topic ?? '').trim().slice(0, 120),
    difficulty: Math.min(5, Math.max(1, Math.round(Number(input.difficulty) || 3))),
    points: Math.min(100, Math.max(0.5, Number(input.points) || 1))
  }

  if (type === 'single' || type === 'multiple') {
    const options = (input.options ?? [])
      .map((o, i) => ({ id: String(o.id || `o${i + 1}`), text: String(o.text ?? '').trim() }))
      .filter((o) => o.text)
    if (options.length < 2) throw new Error('Inclua pelo menos duas alternativas')
    if (new Set(options.map((o) => o.id)).size !== options.length) throw new Error('Alternativas repetidas')
    const ids = new Set(options.map((o) => o.id))
    if (type === 'single') {
      const correct = input.key.type === 'single' ? input.key.correct : ''
      if (!ids.has(correct)) throw new Error('Marque a alternativa correta')
      return { ...base, options, key: { type, correct } }
    }
    const correct = input.key.type === 'multiple' ? [...new Set(input.key.correct)].filter((id) => ids.has(id)) : []
    if (correct.length === 0) throw new Error('Marque pelo menos uma alternativa correta')
    return { ...base, options, key: { type, correct } }
  }

  if (type === 'truefalse') {
    if (input.key.type !== 'truefalse' || typeof input.key.correct !== 'boolean') throw new Error('Escolha se a afirmação é verdadeira ou falsa')
    return { ...base, options: [], key: { type, correct: input.key.correct } }
  }

  if (type === 'short') {
    const accepted = input.key.type === 'short' ? input.key.accepted.map((a) => String(a).trim()).filter(Boolean) : []
    if (accepted.length === 0) throw new Error('Informe pelo menos uma resposta aceita')
    return { ...base, options: [], key: { type, accepted } }
  }

  const reference = input.key.type === 'essay' ? String(input.key.reference ?? '').trim() : ''
  return { ...base, options: [], key: { type: 'essay', reference } }
}

/** Embaralhamento Fisher–Yates; `random` injetável para testes. */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
