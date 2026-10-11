/**
 * Repetição espaçada com o FSRS-6 (Free Spaced Repetition Scheduler), o algoritmo do Anki atual.
 *
 * Cada carta guarda uma memória: estabilidade (S, em dias: tempo até a chance de lembrar cair a 90%) e
 * dificuldade (D, de 1 a 10). Cada resposta atualiza S e D; o próximo intervalo é o tempo até a chance de
 * lembrar cair à retenção desejada do baralho.
 *
 * Estados: `new` (nunca estudado) → `learning` (etapas curtas em minutos) → `review` (intervalos em dias).
 * Errar uma revisão leva a `relearning` (etapas curtas) e depois de volta a `review`.
 * Respostas: 1 Errei · 2 Difícil · 3 Bom · 4 Fácil.
 */

export type CardState = 'new' | 'learning' | 'review' | 'relearning'
export type Rating = 1 | 2 | 3 | 4

export interface Memory {
  stability: number
  difficulty: number
}

export interface SchedulingState {
  state: CardState
  /** Etapa atual dentro de learning/relearning. */
  step: number
  /** Intervalo em dias (em relearning, é o intervalo que a carta terá ao voltar para review). */
  intervalDays: number
  /** Próxima revisão (epoch em segundos). Cartas novas usam 0. */
  due: number
  reps: number
  lapses: number
  lastReviewAt: number | null
  /** Memória do FSRS; null em cartas novas. */
  stability: number | null
  difficulty: number | null
}

/** Opções de cada baralho. */
export interface DeckOptions {
  /** Chance de lembrar no dia da revisão (0,70–0,97). Mais alta = mais revisões. */
  desiredRetention: number
  newPerDay: number
  reviewsPerDay: number
  learningStepsMin: number[]
  relearningStepsMin: number[]
  maxIntervalDays: number
}

export const DEFAULT_DECK_OPTIONS: DeckOptions = {
  desiredRetention: 0.9,
  newPerDay: 20,
  reviewsPerDay: 200,
  learningStepsMin: [1, 10],
  relearningStepsMin: [10],
  maxIntervalDays: 36500
}

export const RETENTION_RANGE = { min: 0.7, max: 0.97 } as const
const MAX_STEPS = 10
const MAX_STEP_MIN = 1440

/** Valida opções vindas da interface ou do banco; o que faltar ou vier inválido usa o padrão. */
export function normalizeDeckOptions(input: unknown): DeckOptions {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const d = DEFAULT_DECK_OPTIONS
  const int = (value: unknown, fallback: number, min: number, max: number) => {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
  }
  const steps = (value: unknown, fallback: number[]) => {
    if (!Array.isArray(value)) return fallback
    const list = value.map(Number).filter((n) => Number.isFinite(n) && n > 0)
    return list.slice(0, MAX_STEPS).map((n) => Math.min(MAX_STEP_MIN, Math.round(n * 100) / 100))
  }
  const retention = typeof o.desiredRetention === 'number' ? o.desiredRetention : NaN
  return {
    desiredRetention: Number.isFinite(retention)
      ? Math.min(RETENTION_RANGE.max, Math.max(RETENTION_RANGE.min, Math.round(retention * 100) / 100))
      : d.desiredRetention,
    newPerDay: int(o.newPerDay, d.newPerDay, 0, 9999),
    reviewsPerDay: int(o.reviewsPerDay, d.reviewsPerDay, 0, 99999),
    learningStepsMin: steps(o.learningStepsMin, d.learningStepsMin),
    relearningStepsMin: steps(o.relearningStepsMin, d.relearningStepsMin),
    maxIntervalDays: int(o.maxIntervalDays, d.maxIntervalDays, 1, 36500)
  }
}

/**
 * Lê etapas escritas como "1m 10m", "1 10" ou "10m 1h" (minutos por padrão). Devolve null se algo não for
 * reconhecido; vazio é válido (sem etapas: a carta vai direto para dias).
 */
export function parseSteps(text: string): number[] | null {
  const tokens = text.trim().split(/[\s;]+/).filter(Boolean)
  if (tokens.length > MAX_STEPS) return null
  const out: number[] = []
  for (const token of tokens) {
    const m = /^(\d+(?:[.,]\d+)?)(m|min|h|d)?$/i.exec(token)
    if (!m) return null
    const n = Number(m[1].replace(',', '.'))
    const unit = (m[2] ?? 'm').toLowerCase()
    const minutes = unit === 'h' ? n * 60 : unit === 'd' ? n * 1440 : n
    if (!(minutes > 0) || minutes > MAX_STEP_MIN) return null
    out.push(Math.round(minutes * 100) / 100)
  }
  return out
}

/** Etapas como texto para edição: "1m 10m", "1h", "1d". */
export function formatSteps(steps: number[]): string {
  return steps
    .map((m) => (m >= 1440 && m % 1440 === 0 ? `${m / 1440}d` : m >= 60 && m % 60 === 0 ? `${m / 60}h` : `${m}m`))
    .join(' ')
}

export function newCardState(): SchedulingState {
  return { state: 'new', step: 0, intervalDays: 0, due: 0, reps: 0, lapses: 0, lastReviewAt: null, stability: null, difficulty: null }
}

// ── FSRS-6 ──────────────────────────────────────────────────────────────────

/** Parâmetros padrão do FSRS-6 (os mesmos do Anki e do ts-fsrs 5). */
export const FSRS_PARAMS: readonly number[] = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483,
  0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542
])

const w = FSRS_PARAMS
const DECAY = -w[20]
/** Escolhido para que a chance de lembrar depois de S dias seja 90%. */
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1
const S_MIN = 0.001
const S_MAX = 36500
const MINUTE = 60
const DAY = 86_400

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Chance de lembrar depois de `elapsedDays` com estabilidade `stability`. */
export function retrievability(elapsedDays: number, stability: number): number {
  return Math.pow(1 + (FACTOR * Math.max(0, elapsedDays)) / stability, DECAY)
}

/** Dias até a chance de lembrar cair a `retention` (sem arredondar). */
export function intervalFor(stability: number, retention: number): number {
  return (stability / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1)
}

const initStability = (g: Rating) => Math.max(w[g - 1], 0.1)
const initDifficulty = (g: Rating) => w[4] - Math.exp((g - 1) * w[5]) + 1

function nextDifficulty(d: number, g: Rating): number {
  const delta = -w[6] * (g - 3)
  const damped = d + (delta * (10 - d)) / 9
  // Reversão à média: puxa de leve para a dificuldade de uma carta respondida "Fácil" de primeira.
  return clamp(w[7] * initDifficulty(4) + (1 - w[7]) * damped, 1, 10)
}

/** Próxima memória depois de responder `g` com `elapsedDays` desde a última revisão. */
export function nextMemory(memory: Memory | null, elapsedDays: number, g: Rating): Memory {
  if (!memory) return { stability: initStability(g), difficulty: clamp(initDifficulty(g), 1, 10) }
  const { stability: s, difficulty: d } = memory
  let stability: number
  if (elapsedDays === 0) {
    // Revisão no mesmo dia (etapas de aprendizado): ajuste de curto prazo.
    const sinc = Math.pow(s, -w[19]) * Math.exp(w[17] * (g - 3 + w[18]))
    stability = s * (g >= 2 ? Math.max(sinc, 1) : sinc)
  } else {
    const r = retrievability(elapsedDays, s)
    if (g === 1) {
      const forget = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14])
      stability = Math.min(forget, s / Math.exp(w[17] * w[18]))
    } else {
      const hard = g === 2 ? w[15] : 1
      const easy = g === 4 ? w[16] : 1
      stability = s * (1 + Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp((1 - r) * w[10]) - 1) * hard * easy)
    }
  }
  return { stability: clamp(stability, S_MIN, S_MAX), difficulty: nextDifficulty(d, g) }
}

/**
 * Memória aproximada de uma carta agendada pelo SM-2 sem histórico: a estabilidade é o intervalo atual (com
 * 90% de retenção os dois coincidem) e a facilidade vira dificuldade (2,5 → 5; 1,3 → 9,8).
 */
export function memoryFromSm2(intervalDays: number, ease: number): Memory {
  return { stability: clamp(intervalDays, 0.1, S_MAX), difficulty: clamp(11 - 4 * (ease - 1), 1, 10) }
}

export interface ReviewRecord {
  rating: Rating
  reviewedAt: number
  stateBefore: CardState
  intervalBefore: number
}

/**
 * Memória reconstruída a partir do histórico de respostas (usado na troca do SM-2 pelo FSRS). Conta só desde a
 * última vez em que a carta estava nova (ela pode ter sido reiniciada). Sem histórico, devolve null.
 */
export function memoryFromHistory(reviews: ReviewRecord[]): Memory | null {
  const lastNew = reviews.map((r) => r.stateBefore).lastIndexOf('new')
  const relevant = lastNew >= 0 ? reviews.slice(lastNew) : reviews
  let memory: Memory | null = null
  let lastAt: number | null = null
  for (const review of relevant) {
    if (!memory && review.stateBefore !== 'new') {
      // Histórico começa no meio (ex.: carta importada já em revisão).
      memory = memoryFromSm2(review.intervalBefore, 2.5)
      lastAt = review.reviewedAt - Math.round(review.intervalBefore) * DAY
    }
    const elapsed = lastAt === null ? 0 : calendarDays(lastAt, review.reviewedAt)
    memory = nextMemory(memory, elapsed, review.rating)
    lastAt = review.reviewedAt
  }
  return memory
}

// ── Agendamento ─────────────────────────────────────────────────────────────

/** Início do dia local de `epochSec`. */
export function startOfLocalDay(epochSec: number): number {
  const d = new Date(epochSec * 1000)
  d.setHours(0, 0, 0, 0)
  return Math.floor(d.getTime() / 1000)
}

/** Meia-noite local `days` dias depois do dia de `epochSec` (respeita horário de verão). */
function dayAfter(epochSec: number, days: number): number {
  const d = new Date(epochSec * 1000)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return Math.floor(d.getTime() / 1000)
}

/** Dias do calendário entre duas datas (o FSRS conta dias, não horas). */
export function calendarDays(fromSec: number, toSec: number): number {
  return Math.max(0, Math.round((startOfLocalDay(toSec) - startOfLocalDay(fromSec)) / DAY))
}

/**
 * Variação dos intervalos longos, para cartas estudadas juntas não vencerem sempre no mesmo dia (faixas do
 * FSRS). `factor` em [0, 1) vem de um sorteio só por resposta, injetável nos testes.
 */
function fuzz(days: number, elapsedDays: number, factor: number, maxDays: number): number {
  if (days < 2.5) return days
  let delta = 1
  for (const [start, end, f] of [
    [2.5, 7, 0.15],
    [7, 20, 0.1],
    [20, Infinity, 0.05]
  ] as const) {
    delta += f * Math.max(Math.min(days, end) - start, 0)
  }
  let min = Math.max(2, Math.round(days - delta))
  const max = Math.min(Math.round(days + delta), maxDays)
  if (days > elapsedDays) min = Math.max(min, elapsedDays + 1)
  min = Math.min(min, max)
  return Math.floor(factor * (max - min + 1) + min)
}

function stepDelayMin(steps: number[], step: number, rating: Rating): number {
  const current = steps[Math.min(step, steps.length - 1)] ?? 1
  if (rating !== 2) return current
  // Difícil: média entre esta etapa e a próxima (ou 1,5× se for a última).
  const next = steps[step + 1]
  return next !== undefined ? (current + next) / 2 : current * 1.5
}

export interface ScheduleOptions {
  options?: DeckOptions
  random?: () => number
}

type Outcome = { kind: 'minutes'; delayMin: number; state: CardState; step: number } | { kind: 'days'; days: number }

/** Resultado de cada uma das quatro respostas. Não altera o original. */
export function scheduleAll(card: SchedulingState, now: number, options: ScheduleOptions = {}): Record<Rating, SchedulingState> {
  const o = options.options ?? DEFAULT_DECK_OPTIONS
  const factor = (options.random ?? Math.random)()
  const ratings: Rating[] = [1, 2, 3, 4]

  const memory: Memory | null =
    card.state === 'new'
      ? null
      : card.stability && card.difficulty
        ? { stability: card.stability, difficulty: card.difficulty }
        : memoryFromSm2(card.intervalDays, 2.5)
  const elapsed =
    card.lastReviewAt !== null ? calendarDays(card.lastReviewAt, now) : card.state === 'review' ? Math.round(card.intervalDays) : 0
  const memories = Object.fromEntries(ratings.map((g) => [g, nextMemory(memory, elapsed, g)])) as Record<Rating, Memory>
  const days = (g: Rating): Outcome => ({ kind: 'days', days: intervalFor(memories[g].stability, o.desiredRetention) })
  const minutes = (delayMin: number, state: CardState, step: number): Outcome => ({ kind: 'minutes', delayMin, state, step })

  const outcomes = {} as Record<Rating, Outcome>
  if (card.state === 'review') {
    const steps = o.relearningStepsMin
    outcomes[1] = steps.length ? minutes(steps[0], 'relearning', 0) : days(1)
    for (const g of [2, 3, 4] as Rating[]) outcomes[g] = days(g)
  } else {
    const relearning = card.state === 'relearning'
    const steps = relearning ? o.relearningStepsMin : o.learningStepsMin
    const state: CardState = relearning ? 'relearning' : 'learning'
    const step = card.state === 'new' ? 0 : Math.min(card.step, Math.max(0, steps.length - 1))
    outcomes[1] = steps.length ? minutes(steps[0], state, 0) : days(1)
    outcomes[2] = steps.length ? minutes(stepDelayMin(steps, step, 2), state, step) : days(2)
    outcomes[3] = step + 1 < steps.length ? minutes(steps[step + 1], state, step + 1) : days(3)
    outcomes[4] = days(4)
  }

  // Intervalos em dias: arredonda, aplica a variação e garante Difícil ≤ Bom < Fácil.
  const dayValues: Partial<Record<Rating, number>> = {}
  for (const g of ratings) {
    const out = outcomes[g]
    if (out.kind === 'days') dayValues[g] = clamp(Math.round(out.days), 1, o.maxIntervalDays)
  }
  const order = () => {
    const [hard, good, easy] = [dayValues[2], dayValues[3], dayValues[4]]
    if (hard !== undefined && good !== undefined) {
      dayValues[2] = Math.min(hard, good)
      dayValues[3] = Math.max(good, dayValues[2] + 1)
    }
    const before = dayValues[3] ?? dayValues[2]
    if (easy !== undefined && before !== undefined) dayValues[4] = Math.max(easy, before + 1)
  }
  order()
  for (const g of ratings) {
    const value = dayValues[g]
    if (value !== undefined) dayValues[g] = fuzz(value, elapsed, factor, o.maxIntervalDays)
  }
  order()
  // No teto, a ordem cede ao máximo do baralho.
  for (const g of ratings) {
    const value = dayValues[g]
    if (value !== undefined) dayValues[g] = clamp(value, 1, o.maxIntervalDays)
  }

  const result = {} as Record<Rating, SchedulingState>
  for (const g of ratings) {
    const out = outcomes[g]
    const base: SchedulingState = {
      ...card,
      reps: card.reps + 1,
      lapses: card.lapses + (card.state === 'review' && g === 1 ? 1 : 0),
      lastReviewAt: now,
      stability: memories[g].stability,
      difficulty: memories[g].difficulty
    }
    if (out.kind === 'days') {
      const interval = dayValues[g]!
      result[g] = { ...base, state: 'review', step: 0, intervalDays: interval, due: dayAfter(now, interval) }
    } else {
      // Em reaprendizado, guarda o intervalo que a carta terá ao voltar para revisão.
      const back = clamp(Math.round(intervalFor(memories[g].stability, o.desiredRetention)), 1, o.maxIntervalDays)
      const interval = out.state === 'relearning' ? back : 0
      result[g] = { ...base, state: out.state, step: out.step, intervalDays: interval, due: now + Math.round(out.delayMin * MINUTE) }
    }
  }
  return result
}

/** Aplica uma resposta e devolve o novo estado da carta. Não altera o original. */
export function schedule(card: SchedulingState, rating: Rating, now: number, options: ScheduleOptions = {}): SchedulingState {
  return scheduleAll(card, now, options)[rating]
}

/** Quanto tempo até a próxima revisão para cada botão, sem variação aleatória. */
export function previewIntervals(card: SchedulingState, now: number, options = DEFAULT_DECK_OPTIONS): Record<Rating, number> {
  const all = scheduleAll(card, now, { options, random: () => 0.5 })
  return { 1: all[1].due - now, 2: all[2].due - now, 3: all[3].due - now, 4: all[4].due - now }
}

/**
 * Rótulo curto de um intervalo: "<1 min", "6 min", "1 h", "1 dia", "4 dias", "2,5 meses", "1,2 ano".
 * Com `now`, intervalos de dias contam dias do calendário: as revisões vencem à meia-noite, então uma carta
 * para daqui a 4 dias continua "4 dias" mesmo vista ao meio-dia (são só 3,5 dias de relógio).
 */
export function formatInterval(seconds: number, now?: number): string {
  if (seconds < MINUTE) return '<1 min'
  if (seconds < 3600) return `${Math.round(seconds / MINUTE)} min`
  if (seconds < DAY * 0.75 && now === undefined) return `${Math.round(seconds / 3600)} h`
  const calendar = now === undefined ? null : Math.round((startOfLocalDay(now + seconds) - startOfLocalDay(now)) / DAY)
  if (calendar === 0) return `${Math.max(1, Math.round(seconds / 3600))} h`
  const days = calendar ?? Math.round(seconds / DAY)
  if (days < 30) return days === 1 ? '1 dia' : `${days} dias`
  const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
  if (days < 365) {
    const months = days / 30
    return `${fmt(months)} ${months < 1.95 ? 'mês' : 'meses'}`
  }
  const years = days / 365
  return `${fmt(years)} ${years < 1.95 ? 'ano' : 'anos'}`
}
