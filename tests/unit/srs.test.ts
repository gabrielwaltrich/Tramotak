import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DECK_OPTIONS,
  formatInterval,
  formatSteps,
  memoryFromHistory,
  memoryFromSm2,
  newCardState,
  normalizeDeckOptions,
  parseSteps,
  previewIntervals,
  retrievability,
  schedule,
  startOfLocalDay,
  type SchedulingState
} from '@shared/srs'

const now = Math.floor(new Date(2026, 9, 11, 15, 0).getTime() / 1000) // 11/10 15h local
const MIN = 60
const DAY = 86_400
const mid = { random: () => 0.5 }
const midnightPlus = (days: number) => {
  const d = new Date(2026, 9, 11 + days)
  return Math.floor(d.getTime() / 1000)
}

/** Carta em revisão, revista pela última vez há `intervalDays` dias (vence hoje, ou atrasada). */
function review(intervalDays: number, stability = intervalDays, difficulty = 5, daysLate = 0): SchedulingState {
  return {
    state: 'review',
    step: 0,
    intervalDays,
    due: startOfLocalDay(now) - daysLate * DAY,
    reps: 5,
    lapses: 0,
    lastReviewAt: now - (intervalDays + daysLate) * DAY,
    stability,
    difficulty
  }
}

describe('cartas novas e em aprendizado', () => {
  const card = newCardState()

  it('Errei e Bom percorrem as etapas de 1 e 10 minutos e ganham memória', () => {
    const again = schedule(card, 1, now, mid)
    expect(again).toMatchObject({ state: 'learning', step: 0, due: now + 1 * MIN, reps: 1 })
    expect(again.stability).toBeCloseTo(0.212, 3)
    const first = schedule(card, 3, now, mid)
    expect(first).toMatchObject({ state: 'learning', step: 1, due: now + 10 * MIN })
    expect(first.stability).toBeCloseTo(2.3065, 3)
    // Bom na última etapa gradua para o intervalo do FSRS (meia-noite de daqui a N dias)
    const graduated = schedule(first, 3, now + 10 * MIN, mid)
    expect(graduated.state).toBe('review')
    expect(graduated.intervalDays).toBeGreaterThanOrEqual(2)
    expect(graduated.intervalDays).toBeLessThanOrEqual(4)
    expect(graduated.due).toBe(midnightPlus(graduated.intervalDays))
  })

  it('Difícil fica na etapa, com espera entre as duas etapas', () => {
    expect(schedule(card, 2, now, mid)).toMatchObject({ state: 'learning', step: 0, due: now + 5.5 * MIN })
  })

  it('Fácil gradua direto, com intervalo maior que o de Bom', () => {
    const easy = schedule(card, 4, now, mid)
    expect(easy).toMatchObject({ state: 'review', intervalDays: 8, due: midnightPlus(8) })
    expect(easy.stability).toBeCloseTo(8.2956, 3)
  })

  it('não altera a carta original', () => {
    schedule(card, 3, now)
    expect(card).toEqual(newCardState())
  })

  it('sem etapas de aprendizado, a carta vai direto para dias', () => {
    const options = { ...DEFAULT_DECK_OPTIONS, learningStepsMin: [] }
    const p = previewIntervals(card, now, options)
    expect(p[1]).toBe(midnightPlus(1) - now)
    expect(p[1]).toBeLessThanOrEqual(p[2])
    expect(p[2]).toBeLessThan(p[3])
    expect(p[3]).toBeLessThan(p[4])
  })
})

describe('revisões', () => {
  it('Bom no dia certo aumenta a estabilidade e o intervalo', () => {
    const next = schedule(review(10), 3, now, mid)
    expect(next.state).toBe('review')
    expect(next.stability!).toBeGreaterThan(10)
    expect(next.intervalDays).toBeGreaterThan(10)
    expect(next.due).toBe(midnightPlus(next.intervalDays))
  })

  it('cartas difíceis crescem menos que as fáceis', () => {
    const easyCard = schedule(review(10, 10, 2), 3, now, mid).intervalDays
    const hardCard = schedule(review(10, 10, 9), 3, now, mid).intervalDays
    expect(hardCard).toBeLessThan(easyCard)
  })

  it('os intervalos ficam sempre em ordem: Difícil < Bom < Fácil', () => {
    for (const interval of [1, 2, 3, 7, 30, 200]) {
      for (const difficulty of [1, 5, 10]) {
        const p = previewIntervals(review(interval, interval, difficulty), now)
        expect(p[2]).toBeLessThan(p[3])
        expect(p[3]).toBeLessThan(p[4])
      }
    }
  })

  it('lembrar depois de mais tempo ganha mais estabilidade', () => {
    const onTime = schedule(review(10), 3, now, mid)
    const late = schedule(review(10, 10, 5, 10), 3, now, mid)
    expect(late.stability!).toBeGreaterThan(onTime.stability!)
  })

  it('Errei vira lapso: reaprendizado de 10 min, estabilidade cai e dificuldade sobe', () => {
    const lapsed = schedule(review(30), 1, now, mid)
    expect(lapsed).toMatchObject({ state: 'relearning', step: 0, lapses: 1, due: now + 10 * MIN })
    expect(lapsed.stability!).toBeLessThan(30)
    expect(lapsed.difficulty!).toBeGreaterThan(5)
    const back = schedule(lapsed, 3, now + 10 * MIN, mid)
    expect(back.state).toBe('review')
    expect(back.intervalDays).toBeLessThan(30)
  })

  it('retenção desejada maior encurta o intervalo', () => {
    const at = (desiredRetention: number) =>
      schedule(review(20), 3, now, { ...mid, options: { ...DEFAULT_DECK_OPTIONS, desiredRetention } }).intervalDays
    expect(at(0.95)).toBeLessThan(at(0.9))
    expect(at(0.9)).toBeLessThan(at(0.8))
  })

  it('o intervalo respeita o máximo do baralho (mesmo com a variação para cima)', () => {
    const top = { random: () => 0.999 }
    expect(schedule(review(30000), 4, now, top).intervalDays).toBe(36500)
    const options = { ...DEFAULT_DECK_OPTIONS, maxIntervalDays: 60 }
    expect(schedule(review(50), 4, now, { ...top, options }).intervalDays).toBe(60)
    expect(schedule(review(50), 4, now, { ...mid, options }).intervalDays).toBeLessThanOrEqual(60)
  })

  it('a variação aleatória fica perto do intervalo calculado', () => {
    const low = schedule(review(10), 3, now, { random: () => 0 }).intervalDays
    const high = schedule(review(10), 3, now, { random: () => 0.999 }).intervalDays
    const middle = schedule(review(10), 3, now, mid).intervalDays
    expect(low).toBeLessThan(high)
    expect(middle - low).toBeLessThanOrEqual(Math.ceil(middle * 0.12) + 1)
    expect(high - middle).toBeLessThanOrEqual(Math.ceil(middle * 0.12) + 1)
  })

  it('carta do SM-2 sem memória usa o intervalo como estabilidade', () => {
    const legacy = { ...review(10), stability: null, difficulty: null }
    expect(schedule(legacy, 3, now, mid).intervalDays).toBe(schedule(review(10), 3, now, mid).intervalDays)
  })
})

describe('troca do SM-2 pelo FSRS', () => {
  it('aproxima a memória pelo intervalo e pela facilidade', () => {
    expect(memoryFromSm2(10, 2.5)).toEqual({ stability: 10, difficulty: 5 })
    expect(memoryFromSm2(3, 1.3).difficulty).toBeCloseTo(9.8)
    expect(memoryFromSm2(0, 3.5)).toEqual({ stability: 0.1, difficulty: 1 })
  })

  it('refaz o histórico: estabilidade cresce com acertos e reinício recomeça do zero', () => {
    const t = (days: number) => now + days * DAY
    const history = [
      { rating: 3 as const, reviewedAt: t(0), stateBefore: 'new' as const, intervalBefore: 0 },
      { rating: 3 as const, reviewedAt: t(0) + 600, stateBefore: 'learning' as const, intervalBefore: 0 },
      { rating: 3 as const, reviewedAt: t(3), stateBefore: 'review' as const, intervalBefore: 3 },
      { rating: 3 as const, reviewedAt: t(12), stateBefore: 'review' as const, intervalBefore: 9 }
    ]
    const memory = memoryFromHistory(history)!
    expect(memory.stability).toBeGreaterThan(9)
    expect(retrievability(0, memory.stability)).toBe(1)
    expect(memoryFromHistory([])).toBeNull()
    // Reiniciada: só conta a partir da última vez em que estava nova.
    const reset = memoryFromHistory([...history, { rating: 4, reviewedAt: t(20), stateBefore: 'new', intervalBefore: 0 }])!
    expect(reset.stability).toBeCloseTo(8.2956, 3)
  })
})

describe('opções do baralho', () => {
  it('lê etapas em minutos, horas e dias', () => {
    expect(parseSteps('1m 10m')).toEqual([1, 10])
    expect(parseSteps('1 10 1h')).toEqual([1, 10, 60])
    expect(parseSteps('1d')).toEqual([1440])
    expect(parseSteps('')).toEqual([])
    expect(parseSteps('abc')).toBeNull()
    expect(parseSteps('2d')).toBeNull()
    expect(formatSteps([1, 10, 60, 1440])).toBe('1m 10m 1h 1d')
  })

  it('normaliza valores fora da faixa e usa o padrão no que falta', () => {
    expect(normalizeDeckOptions({})).toEqual(DEFAULT_DECK_OPTIONS)
    expect(normalizeDeckOptions(null)).toEqual(DEFAULT_DECK_OPTIONS)
    const o = normalizeDeckOptions({ desiredRetention: 0.5, newPerDay: -3, reviewsPerDay: '50', learningStepsMin: [5, 'x', -1], maxIntervalDays: 0 })
    expect(o).toMatchObject({ desiredRetention: 0.7, newPerDay: 0, reviewsPerDay: 50, learningStepsMin: [5], maxIntervalDays: 1 })
    expect(normalizeDeckOptions({ desiredRetention: 0.99 }).desiredRetention).toBe(0.97)
  })
})

describe('formatInterval com dias do calendário', () => {
  it('revisão para daqui a 4 dias é "4 dias" a qualquer hora (vence à meia-noite)', () => {
    for (const hour of [1, 12, 23]) {
      const now = Math.floor(new Date(2026, 9, 11, hour, 30).getTime() / 1000)
      const due = Math.floor(new Date(2026, 9, 15).getTime() / 1000)
      expect(formatInterval(due - now, now)).toBe('4 dias')
    }
  })

  it('no mesmo dia continua em minutos/horas; amanhã é 1 dia', () => {
    const now = Math.floor(new Date(2026, 9, 11, 20, 0).getTime() / 1000)
    expect(formatInterval(600, now)).toBe('10 min')
    expect(formatInterval(2 * 3600, now)).toBe('2 h')
    expect(formatInterval(5 * 3600, now)).toBe('1 dia')
  })
})

describe('formatInterval', () => {
  it.each([
    [30, '<1 min'],
    [330, '6 min'],
    [600, '10 min'],
    [3 * 3600, '3 h'],
    [DAY, '1 dia'],
    [4 * DAY, '4 dias'],
    [45 * DAY, '1,5 mês'],
    [75 * DAY, '2,5 meses'],
    [400 * DAY, '1,1 ano'],
    [800 * DAY, '2,2 anos']
  ])('%i s → %s', (sec, expected) => expect(formatInterval(sec)).toBe(expected))
})
