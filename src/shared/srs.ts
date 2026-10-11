/**
 * Agendador de repetição espaçada no estilo SM-2 do Anki.
 *
 * Estados: `new` (nunca estudado) → `learning` (etapas curtas em minutos) → `review` (intervalos em dias).
 * Errar uma revisão leva a `relearning` (etapas curtas) e depois de volta a `review`.
 * Respostas: 1 Errei · 2 Difícil · 3 Bom · 4 Fácil.
 */

export type CardState = 'new' | 'learning' | 'review' | 'relearning'
export type Rating = 1 | 2 | 3 | 4

export interface SchedulingState {
  state: CardState
  /** Etapa atual dentro de learning/relearning. */
  step: number
  /** Intervalo em dias (em relearning, é o intervalo que a carta terá ao voltar para review). */
  intervalDays: number
  ease: number
  /** Próxima revisão (epoch em segundos). Cartas novas usam 0. */
  due: number
  reps: number
  lapses: number
  lastReviewAt: number | null
}

export interface SrsConfig {
  learningStepsMin: number[]
  relearningStepsMin: number[]
  graduatingIntervalDays: number
  easyIntervalDays: number
  startingEase: number
  minEase: number
  easyBonus: number
  hardMultiplier: number
  intervalModifier: number
  maxIntervalDays: number
  /** Fração do intervalo antigo mantida após um lapso (0 = recomeça de 1 dia). */
  lapseNewInterval: number
}

export const DEFAULT_SRS: SrsConfig = {
  learningStepsMin: [1, 10],
  relearningStepsMin: [10],
  graduatingIntervalDays: 1,
  easyIntervalDays: 4,
  startingEase: 2.5,
  minEase: 1.3,
  easyBonus: 1.3,
  hardMultiplier: 1.2,
  intervalModifier: 1,
  maxIntervalDays: 36500,
  lapseNewInterval: 0
}

export function newCardState(config = DEFAULT_SRS): SchedulingState {
  return { state: 'new', step: 0, intervalDays: 0, ease: config.startingEase, due: 0, reps: 0, lapses: 0, lastReviewAt: null }
}

const MINUTE = 60
const DAY = 86_400

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

/**
 * Variação aleatória de intervalos longos, para cartas criadas juntas não vencerem sempre no mesmo dia.
 * `random` é injetável para os testes serem determinísticos.
 */
function fuzz(intervalDays: number, random: () => number): number {
  if (intervalDays < 2.5) return intervalDays
  const range = intervalDays < 7 ? 1 : intervalDays < 30 ? Math.max(2, intervalDays * 0.15) : Math.max(4, intervalDays * 0.05)
  return Math.max(2, Math.round(intervalDays - range + random() * 2 * range))
}

function clampInterval(days: number, config: SrsConfig): number {
  return Math.min(config.maxIntervalDays, Math.max(1, Math.round(days)))
}

function stepDelayMin(steps: number[], step: number, rating: Rating): number {
  const current = steps[Math.min(step, steps.length - 1)] ?? 1
  if (rating !== 2) return current
  // Difícil: média entre esta etapa e a próxima (ou 1,5× se for a última).
  const next = steps[step + 1]
  return next !== undefined ? (current + next) / 2 : current * 1.5
}

export interface ScheduleOptions {
  config?: SrsConfig
  random?: () => number
}

/** Aplica uma resposta e devolve o novo estado da carta. Não altera o original. */
export function schedule(card: SchedulingState, rating: Rating, now: number, options: ScheduleOptions = {}): SchedulingState {
  const config = options.config ?? DEFAULT_SRS
  const random = options.random ?? Math.random
  const base = { ...card, reps: card.reps + 1, lastReviewAt: now }

  const graduate = (intervalDays: number): SchedulingState => {
    const interval = clampInterval(intervalDays, config)
    return { ...base, state: 'review', step: 0, intervalDays: interval, due: dayAfter(now, interval) }
  }

  if (card.state === 'new' || card.state === 'learning') {
    const steps = config.learningStepsMin
    const step = card.state === 'new' ? 0 : card.step
    if (rating === 4) return graduate(config.easyIntervalDays)
    if (rating === 1) return { ...base, state: 'learning', step: 0, due: now + steps[0] * MINUTE }
    if (rating === 2) return { ...base, state: 'learning', step, due: now + stepDelayMin(steps, step, 2) * MINUTE }
    const next = step + 1
    if (next >= steps.length) return graduate(config.graduatingIntervalDays)
    return { ...base, state: 'learning', step: next, due: now + steps[next] * MINUTE }
  }

  if (card.state === 'relearning') {
    const steps = config.relearningStepsMin
    if (rating === 4) return graduate(card.intervalDays + 1)
    if (rating === 1) return { ...base, step: 0, due: now + steps[0] * MINUTE }
    if (rating === 2) return { ...base, due: now + stepDelayMin(steps, card.step, 2) * MINUTE }
    const next = card.step + 1
    if (next >= steps.length) return graduate(card.intervalDays)
    return { ...base, step: next, due: now + steps[next] * MINUTE }
  }

  // review
  if (rating === 1) {
    const kept = clampInterval(card.intervalDays * config.lapseNewInterval, config)
    return {
      ...base,
      state: 'relearning',
      step: 0,
      lapses: card.lapses + 1,
      ease: Math.max(config.minEase, card.ease - 0.2),
      intervalDays: kept,
      due: now + config.relearningStepsMin[0] * MINUTE
    }
  }

  // Dias de atraso entram no cálculo, como no Anki: quem lembrou depois de mais tempo ganha mais.
  const daysLate = Math.max(0, (startOfLocalDay(now) - startOfLocalDay(card.due)) / DAY)
  const current = card.intervalDays
  const m = config.intervalModifier
  const hard = Math.max(current + 1, current * config.hardMultiplier * m)
  const good = Math.max(hard + 1, (current + daysLate / 2) * card.ease * m)
  const easy = Math.max(good + 1, (current + daysLate) * card.ease * config.easyBonus * m)

  const raw = rating === 2 ? hard : rating === 3 ? good : easy
  const ease =
    rating === 2 ? Math.max(config.minEase, card.ease - 0.15) : rating === 4 ? card.ease + 0.15 : card.ease
  const interval = clampInterval(fuzz(raw, random), config)
  return { ...base, state: 'review', step: 0, ease, intervalDays: interval, due: dayAfter(now, interval) }
}

/** Quanto tempo até a próxima revisão para cada botão, sem variação aleatória. */
export function previewIntervals(card: SchedulingState, now: number, config = DEFAULT_SRS): Record<Rating, number> {
  const middle = () => 0.5
  const out = {} as Record<Rating, number>
  for (const rating of [1, 2, 3, 4] as Rating[]) {
    out[rating] = schedule(card, rating, now, { config, random: middle }).due - now
  }
  return out
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
