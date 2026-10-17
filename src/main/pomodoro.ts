import {
  advance,
  applySettings,
  focusCredit,
  initialState,
  pause,
  phaseMs,
  PHASE_LABEL,
  reset,
  start,
  type PomodoroSettings,
  type PomodoroState
} from '@shared/pomodoro'
import type { PomodoroCommand, PomodoroView } from '@shared/ipc'
import { dayKey } from '@shared/streak'
import type { Database } from './db/database'
import { getInternal, getSettings, setInternal } from './db/settings'
import { measuredSessions, recordFocusTime } from './db/study'

const STATE_KEY = 'pomodoro'

interface Deps {
  db: Database
  /** Aviso do sistema no fim de uma fase. */
  notify: (title: string, body: string) => void
  /** Estado novo para as janelas. */
  broadcast: (view: PomodoroView) => void
  now?: () => number
}

const minutes = (ms: number) => `${Math.round(ms / 60_000)} min`

/**
 * Relógio do Pomodoro. Fica no processo principal para seguir rodando ao trocar de tela e avisar com a janela
 * minimizada. O tempo de foco que o app não mediu sozinho (vídeo, PDF, flashcards) entra como tempo de estudo.
 */
export class Pomodoro {
  private state: PomodoroState
  private timer: NodeJS.Timeout | null = null
  private readonly now: () => number

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? Date.now
    const settings = this.settings()
    const saved = getInternal(deps.db, STATE_KEY) as PomodoroState | undefined
    let state = isState(saved) ? saved : initialState(settings, dayKey(new Date(this.now())))
    // Rodando ao abrir: o app fechou sem pausar (queda). Fica pausado, sem contar o tempo em que esteve fechado.
    if (state.running) {
      const left = state.endsAt !== null ? state.endsAt - this.now() : 0
      state = { ...state, running: false, endsAt: null, segmentStart: null, remainingMs: left > 0 ? left : phaseMs(state.phase, settings) }
    }
    this.state = state
    this.save()
  }

  view(): PomodoroView {
    return { state: this.state, settings: this.settings(), now: this.now() }
  }

  command(cmd: PomodoroCommand): PomodoroView {
    const now = this.now()
    const settings = this.settings()
    if (cmd === 'start') this.state = start(this.state, now)
    else if (cmd === 'pause') {
      this.credit(now)
      this.state = pause(this.state, now)
    } else if (cmd === 'reset') {
      this.credit(now)
      this.state = reset(this.state, settings)
    } else if (cmd === 'skip') {
      this.credit(now)
      this.state = advance(this.state, settings, now, false, this.day(now)).state
    } else throw new Error('Comando inválido')
    this.changed()
    return this.view()
  }

  settingsChanged(before: PomodoroSettings, after: PomodoroSettings): void {
    this.state = applySettings(this.state, before, after)
    this.changed()
  }

  /** Ao sair do app: pausa (e conta o foco até agora), para não somar o tempo com o app fechado. */
  stop(): void {
    if (this.state.running) {
      const now = this.now()
      this.credit(now)
      this.state = pause(this.state, now)
      this.save()
    }
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Confere se a fase acabou (o timer chama; os testes também). */
  tick(): void {
    const now = this.now()
    if (!this.state.running || this.state.endsAt === null || now < this.state.endsAt) return this.schedule()
    const endedAt = this.state.endsAt
    this.credit(endedAt)
    const settings = this.settings()
    const { state, end } = advance(this.state, settings, endedAt, true, this.day(endedAt))
    // A próxima fase começa no momento em que a anterior acabou, mesmo que o aviso chegue um pouco depois.
    this.state = state
    if (settings.notify) {
      const next = `${PHASE_LABEL[end.next]} de ${minutes(phaseMs(end.next, settings))}`
      this.deps.notify(
        end.ended === 'focus' ? 'Fim do bloco de foco' : 'Fim da pausa',
        state.running ? `${next} começou.` : `Próximo: ${next.toLowerCase()}. Abra o Tramotak para começar.`
      )
    }
    this.changed()
  }

  private credit(until: number): void {
    const { phase, running, segmentStart } = this.state
    if (phase !== 'focus' || !running || segmentStart === null || until <= segmentStart) return
    const seconds = focusCredit(segmentStart, until, measuredSessions(this.deps.db, segmentStart / 1000, until / 1000))
    recordFocusTime(this.deps.db, segmentStart / 1000, until / 1000, seconds)
  }

  private changed(): void {
    this.save()
    this.schedule()
    this.deps.broadcast(this.view())
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.state.running || this.state.endsAt === null) return
    // Confere ao menos a cada minuto: o relógio do sistema pode mudar (suspensão, fuso).
    const wait = Math.min(60_000, Math.max(0, this.state.endsAt - this.now()))
    this.timer = setTimeout(() => this.tick(), wait + 50)
    this.timer.unref?.()
  }

  private save(): void {
    setInternal(this.deps.db, STATE_KEY, this.state)
  }

  private settings(): PomodoroSettings {
    return getSettings(this.deps.db).pomodoro
  }

  private day(ms: number): string {
    return dayKey(new Date(ms))
  }
}

function isState(v: unknown): v is PomodoroState {
  const s = v as PomodoroState | undefined
  return (
    !!s &&
    ['focus', 'short', 'long'].includes(s.phase) &&
    typeof s.running === 'boolean' &&
    typeof s.remainingMs === 'number' &&
    Number.isFinite(s.remainingMs) &&
    Number.isInteger(s.cycle) &&
    typeof s.today?.day === 'string' &&
    Number.isInteger(s.today?.blocks)
  )
}
