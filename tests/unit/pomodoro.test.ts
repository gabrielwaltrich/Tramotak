import { describe, expect, it, vi } from 'vitest'
import {
  advance,
  applySettings,
  DEFAULT_POMODORO_SETTINGS as S,
  focusCredit,
  formatTimer,
  initialState,
  normalizePomodoroSettings,
  pause,
  remaining,
  reset,
  start
} from '../../src/shared/pomodoro'
import { openDatabase } from '../../src/main/db/database'
import { recordStudyTime } from '../../src/main/db/study'
import { getSettings, setInternal, updateSettings } from '../../src/main/db/settings'
import { Pomodoro } from '../../src/main/pomodoro'

const MIN = 60_000
const T0 = new Date(2026, 9, 16, 9, 0, 0).getTime()

describe('Pomodoro: regras puras', () => {
  it('configurações fora da faixa voltam ao padrão', () => {
    expect(normalizePomodoroSettings(undefined)).toEqual(S)
    expect(normalizePomodoroSettings({ focusMinutes: 50, shortBreakMinutes: 0, longBreakEvery: 3, notify: false, autoStartFocus: 'sim' })).toEqual({
      ...S,
      focusMinutes: 50,
      longBreakEvery: 3,
      notify: false
    })
  })

  it('começa, pausa e retoma guardando o que falta', () => {
    let s = initialState(S, '2026-10-16')
    expect(remaining(s, T0)).toBe(25 * MIN)
    s = start(s, T0)
    expect(s).toMatchObject({ running: true, endsAt: T0 + 25 * MIN, segmentStart: T0 })
    expect(remaining(s, T0 + 10 * MIN)).toBe(15 * MIN)
    s = pause(s, T0 + 10 * MIN)
    expect(s).toMatchObject({ running: false, endsAt: null, remainingMs: 15 * MIN, segmentStart: null })
    expect(start(s, T0 + 20 * MIN).endsAt).toBe(T0 + 35 * MIN)
    expect(formatTimer(15 * MIN)).toBe('15:00')
    expect(formatTimer(61_500)).toBe('01:02')
  })

  it('foco → pausa curta; a cada 4 focos, pausa longa; pular não conta o bloco', () => {
    let s = initialState(S, 'd')
    const run = (completed: boolean) => {
      const r = advance(start(s, T0), S, T0, completed, 'd')
      s = r.state
      return r.end
    }
    expect(run(true)).toEqual({ ended: 'focus', next: 'short' })
    // A pausa começa sozinha (padrão); o foco seguinte não
    expect(s).toMatchObject({ phase: 'short', running: true, cycle: 1, today: { day: 'd', blocks: 1 } })
    run(true)
    expect(s).toMatchObject({ phase: 'focus', running: false })
    run(false)
    expect(s).toMatchObject({ phase: 'short', cycle: 1, today: { blocks: 1 } })
    run(false)
    for (let i = 0; i < 3; i++) {
      run(true)
      if (i < 2) run(true)
    }
    expect(s).toMatchObject({ phase: 'long', cycle: 4, today: { blocks: 4 }, remainingMs: 15 * MIN })
    run(true)
    expect(s).toMatchObject({ phase: 'focus', cycle: 0 })
    // Dia novo: a contagem do dia recomeça
    expect(advance(start(s, T0), S, T0, true, 'outro').state.today).toEqual({ day: 'outro', blocks: 1 })
    expect(reset(s, S)).toMatchObject({ phase: 'focus', cycle: 0, running: false, remainingMs: 25 * MIN, today: s.today })
  })

  it('durações novas valem para a fase parada que ainda não começou', () => {
    const fresh = initialState(S, 'd')
    const longer = { ...S, focusMinutes: 50 }
    expect(applySettings(fresh, S, longer).remainingMs).toBe(50 * MIN)
    const half = pause(start(fresh, T0), T0 + 5 * MIN)
    expect(applySettings(half, S, longer).remainingMs).toBe(20 * MIN)
  })

  it('crédito do foco desconta o que o app já mediu no período', () => {
    const from = T0
    const to = T0 + 25 * MIN
    expect(focusCredit(from, to, [])).toBe(1500)
    // Vídeo de 10 min dentro do bloco
    expect(focusCredit(from, to, [{ startedAt: from / 1000 + 60, endedAt: from / 1000 + 660, seconds: 600 }])).toBe(900)
    // Sessão que começou antes e terminou no meio, com metade do tempo efetivo
    expect(focusCredit(from, to, [{ startedAt: from / 1000 - 600, endedAt: from / 1000 + 600, seconds: 600 }])).toBe(1200)
    // Nunca negativo
    expect(focusCredit(from, to, [{ startedAt: from / 1000, endedAt: to / 1000, seconds: 5000 }])).toBe(0)
  })
})

describe('Pomodoro: relógio no processo principal', () => {
  const setup = (settings = S) => {
    const db = openDatabase(':memory:')
    updateSettings(db, { pomodoro: settings })
    let now = T0
    const notify = vi.fn()
    const broadcast = vi.fn()
    const timer = new Pomodoro({ db, notify, broadcast, now: () => now })
    const study = () => db.prepare('SELECT lesson_id AS lessonId, seconds, source FROM study_sessions ORDER BY id').all()
    return { db, timer, notify, broadcast, study, at: (ms: number) => (now = T0 + ms) }
  }

  it('fim do foco: conta o tempo não medido, avisa e começa a pausa', () => {
    const { db, timer, notify, broadcast, study, at } = setup()
    timer.command('start')
    // 10 min de vídeo medidos pelo app durante o bloco
    at(15 * MIN)
    recordStudyTime(db, null, 600, (T0 + 15 * MIN) / 1000)
    at(25 * MIN + 500)
    timer.tick()
    expect(study()).toEqual([
      { lessonId: null, seconds: 600, source: null },
      { lessonId: null, seconds: 900, source: 'pomodoro' }
    ])
    expect(notify).toHaveBeenCalledWith('Fim do bloco de foco', 'Pausa curta de 5 min começou.')
    expect(timer.view().state).toMatchObject({ phase: 'short', running: true, endsAt: T0 + 30 * MIN, today: { blocks: 1 } })
    expect(broadcast).toHaveBeenCalled()
    timer.stop()
  })

  it('pausar e pular contam só o trecho de foco; sessões do app não se juntam às do Pomodoro', () => {
    const { db, timer, study, at } = setup()
    timer.command('start')
    at(10 * MIN)
    timer.command('pause')
    expect(study()).toEqual([{ lessonId: null, seconds: 600, source: 'pomodoro' }])
    at(12 * MIN)
    timer.command('start')
    // 1 min de flashcards medido pelo app no meio do trecho: vira uma sessão própria, não entra na do Pomodoro
    at(13 * MIN)
    recordStudyTime(db, null, 60, (T0 + 13 * MIN) / 1000)
    expect(study()).toHaveLength(2)
    at(14 * MIN)
    timer.command('skip')
    expect(study().at(-1)).toEqual({ lessonId: null, seconds: 60, source: 'pomodoro' })
    expect(timer.view().state).toMatchObject({ phase: 'short', running: false, today: { blocks: 0 } })
    timer.stop()
  })

  it('sem aviso quando desligado; foco seguinte não começa sozinho por padrão', () => {
    const { timer, notify, at } = setup({ ...S, notify: false, autoStartBreaks: false })
    timer.command('start')
    at(25 * MIN)
    timer.tick()
    expect(notify).not.toHaveBeenCalled()
    expect(timer.view().state).toMatchObject({ phase: 'short', running: false })
  })

  it('ao sair, pausa e conta até ali; ao abrir com o relógio rodando (queda), fica pausado sem somar', () => {
    const { db, timer, study, at } = setup()
    timer.command('start')
    at(5 * MIN)
    timer.stop()
    expect(study()).toEqual([{ lessonId: null, seconds: 300, source: 'pomodoro' }])
    expect(new Pomodoro({ db, notify: vi.fn(), broadcast: vi.fn(), now: () => T0 + 60 * MIN }).view().state).toMatchObject({ running: false, remainingMs: 20 * MIN })

    setInternal(db, 'pomodoro', { ...timer.view().state, running: true, endsAt: T0 + 30 * MIN, segmentStart: T0 })
    const reopened = new Pomodoro({ db, notify: vi.fn(), broadcast: vi.fn(), now: () => T0 + 10 * MIN })
    expect(reopened.view().state).toMatchObject({ running: false, remainingMs: 20 * MIN, segmentStart: null })
    expect(study()).toHaveLength(1)
    // Estado guardado inválido: começa do zero
    setInternal(db, 'pomodoro', { phase: 'x' })
    expect(new Pomodoro({ db, notify: vi.fn(), broadcast: vi.fn(), now: () => T0 }).view().state).toMatchObject({ phase: 'focus', remainingMs: 25 * MIN })
  })

  it('mudar a duração nas configurações vale para o foco que ainda não começou', () => {
    const { db, timer } = setup()
    const before = getSettings(db).pomodoro
    const after = updateSettings(db, { pomodoro: { ...before, focusMinutes: 50 } }).pomodoro
    timer.settingsChanged(before, after)
    expect(timer.view().state.remainingMs).toBe(50 * MIN)
    expect(() => timer.command('voar' as never)).toThrow('Comando inválido')
  })
})
