/**
 * Pomodoro: blocos de foco e pausas. Lógica pura (o relógio de verdade fica no processo principal), para testar sem
 * esperar minutos. Tempos em milissegundos desde a época, como `Date.now()`.
 */

export type PomodoroPhase = 'focus' | 'short' | 'long'

export const PHASE_LABEL: Record<PomodoroPhase, string> = { focus: 'Foco', short: 'Pausa curta', long: 'Pausa longa' }

export interface PomodoroSettings {
  focusMinutes: number
  shortBreakMinutes: number
  longBreakMinutes: number
  /** A cada quantos blocos de foco vem a pausa longa. */
  longBreakEvery: number
  /** Ao terminar o foco, a pausa começa sozinha. */
  autoStartBreaks: boolean
  /** Ao terminar a pausa, o próximo foco começa sozinho. */
  autoStartFocus: boolean
  /** Aviso do sistema no fim de cada ciclo. */
  notify: boolean
}

export const DEFAULT_POMODORO_SETTINGS: PomodoroSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  autoStartBreaks: true,
  autoStartFocus: false,
  notify: true
}

export const POMODORO_LIMITS = {
  focusMinutes: [5, 120],
  shortBreakMinutes: [1, 30],
  longBreakMinutes: [5, 60],
  longBreakEvery: [2, 8]
} as const

export function normalizePomodoroSettings(raw: unknown): PomodoroSettings {
  const r = (raw ?? {}) as Record<string, unknown>
  const out = { ...DEFAULT_POMODORO_SETTINGS }
  for (const key of Object.keys(POMODORO_LIMITS) as (keyof typeof POMODORO_LIMITS)[]) {
    const [min, max] = POMODORO_LIMITS[key]
    const n = Number(r[key])
    if (Number.isInteger(n) && n >= min && n <= max) out[key] = n
  }
  for (const key of ['autoStartBreaks', 'autoStartFocus', 'notify'] as const) {
    if (typeof r[key] === 'boolean') out[key] = r[key] as boolean
  }
  return out
}

export interface PomodoroState {
  phase: PomodoroPhase
  running: boolean
  /** Quando a fase acaba (rodando); `null` parado. */
  endsAt: number | null
  /** Quanto falta (parado); rodando, vale `endsAt - agora`. */
  remainingMs: number
  /** Blocos de foco terminados na sequência atual (a pausa longa zera). */
  cycle: number
  /** Início do trecho de foco rodando agora (para contar o tempo de estudo). */
  segmentStart: number | null
  /** Blocos de foco terminados hoje. */
  today: { day: string; blocks: number }
}

/** Quando uma fase termina, para avisar a pessoa e registrar o tempo. */
export interface PhaseEnd {
  ended: PomodoroPhase
  next: PomodoroPhase
}

export const phaseMs = (phase: PomodoroPhase, s: PomodoroSettings): number =>
  (phase === 'focus' ? s.focusMinutes : phase === 'short' ? s.shortBreakMinutes : s.longBreakMinutes) * 60_000

export function initialState(s: PomodoroSettings, day: string): PomodoroState {
  return { phase: 'focus', running: false, endsAt: null, remainingMs: phaseMs('focus', s), cycle: 0, segmentStart: null, today: { day, blocks: 0 } }
}

export function remaining(state: PomodoroState, now: number): number {
  return state.running && state.endsAt !== null ? Math.max(0, state.endsAt - now) : state.remainingMs
}

export function start(state: PomodoroState, now: number): PomodoroState {
  if (state.running) return state
  return { ...state, running: true, endsAt: now + state.remainingMs, segmentStart: state.phase === 'focus' ? now : null }
}

export function pause(state: PomodoroState, now: number): PomodoroState {
  if (!state.running) return state
  return { ...state, running: false, endsAt: null, remainingMs: remaining(state, now), segmentStart: null }
}

/** Volta ao começo do foco, zerando a sequência. */
export function reset(state: PomodoroState, s: PomodoroSettings): PomodoroState {
  return { ...initialState(s, state.today.day), today: state.today }
}

/** Próxima fase depois desta (o foco que terminou já conta em `cycle`). */
export function nextPhase(phase: PomodoroPhase, cycle: number, s: PomodoroSettings): PomodoroPhase {
  if (phase !== 'focus') return 'focus'
  return cycle > 0 && cycle % s.longBreakEvery === 0 ? 'long' : 'short'
}

/**
 * Passa para a próxima fase. `completed`: a fase chegou ao fim (conta o bloco de foco); senão foi pulada.
 * A próxima começa rodando se a configuração mandar (e se a anterior terminou sozinha).
 */
export function advance(state: PomodoroState, s: PomodoroSettings, now: number, completed: boolean, day: string): { state: PomodoroState; end: PhaseEnd } {
  const today = state.today.day === day ? state.today : { day, blocks: 0 }
  const focusDone = state.phase === 'focus' && completed
  const cycle = state.phase === 'long' ? 0 : focusDone ? state.cycle + 1 : state.cycle
  const next = state.phase === 'focus' ? (completed ? nextPhase('focus', cycle, s) : 'short') : 'focus'
  const auto = completed && (next === 'focus' ? s.autoStartFocus : s.autoStartBreaks)
  const base: PomodoroState = {
    phase: next,
    running: false,
    endsAt: null,
    remainingMs: phaseMs(next, s),
    cycle,
    segmentStart: null,
    today: { day, blocks: today.blocks + (focusDone ? 1 : 0) }
  }
  return { state: auto ? start(base, now) : base, end: { ended: state.phase, next } }
}

/**
 * Configurações mudaram: uma fase parada que ainda não começou passa a ter a duração nova. A que está rodando, ou
 * parada no meio, continua com o que faltava.
 */
export function applySettings(state: PomodoroState, before: PomodoroSettings, after: PomodoroSettings): PomodoroState {
  if (state.running || state.remainingMs !== phaseMs(state.phase, before)) return state
  return { ...state, remainingMs: phaseMs(state.phase, after) }
}

/**
 * Tempo de estudo de um trecho de foco que ainda não foi medido pelo app (vídeo, PDF, flashcards), para não contar
 * duas vezes. `measured`: sessões já registradas, com início, fim e segundos efetivos (sessões juntam pausas
 * curtas, então só a fração que cai dentro do trecho conta).
 */
export function focusCredit(segmentStart: number, segmentEnd: number, measured: { startedAt: number; endedAt: number; seconds: number }[]): number {
  const from = segmentStart / 1000
  const to = segmentEnd / 1000
  const total = Math.max(0, to - from)
  let inside = 0
  for (const m of measured) {
    const overlap = Math.min(to, m.endedAt) - Math.max(from, m.startedAt)
    if (overlap <= 0) continue
    const span = Math.max(1, m.endedAt - m.startedAt)
    inside += Math.min(overlap, m.seconds * (overlap / span))
  }
  return Math.max(0, Math.round(total - inside))
}

export function formatTimer(ms: number): string {
  const total = Math.ceil(ms / 1000)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
