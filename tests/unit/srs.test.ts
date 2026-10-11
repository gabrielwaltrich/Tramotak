import { describe, expect, it } from 'vitest'
import { formatInterval, newCardState, previewIntervals, schedule, startOfLocalDay, type SchedulingState } from '@shared/srs'

const now = Math.floor(new Date(2026, 9, 11, 15, 0).getTime() / 1000) // 11/10 15h local
const MIN = 60
const DAY = 86_400
const mid = { random: () => 0.5 }
const midnightPlus = (days: number) => {
  const d = new Date(2026, 9, 11 + days)
  return Math.floor(d.getTime() / 1000)
}

function review(intervalDays: number, ease = 2.5, dueDaysAgo = 0): SchedulingState {
  return { state: 'review', step: 0, intervalDays, ease, due: startOfLocalDay(now) - dueDaysAgo * DAY, reps: 5, lapses: 0, lastReviewAt: now - intervalDays * DAY }
}

describe('cartas novas e em aprendizado', () => {
  const card = newCardState()

  it('Errei e Bom percorrem as etapas de 1 e 10 minutos', () => {
    expect(schedule(card, 1, now)).toMatchObject({ state: 'learning', step: 0, due: now + 1 * MIN, reps: 1 })
    const first = schedule(card, 3, now)
    expect(first).toMatchObject({ state: 'learning', step: 1, due: now + 10 * MIN })
    // Bom na última etapa gradua para 1 dia (meia-noite de amanhã)
    expect(schedule(first, 3, now)).toMatchObject({ state: 'review', intervalDays: 1, due: midnightPlus(1) })
  })

  it('Difícil fica na etapa, com espera entre as duas etapas', () => {
    expect(schedule(card, 2, now)).toMatchObject({ state: 'learning', step: 0, due: now + 5.5 * MIN })
  })

  it('Fácil gradua direto para 4 dias', () => {
    expect(schedule(card, 4, now)).toMatchObject({ state: 'review', intervalDays: 4, due: midnightPlus(4) })
  })

  it('não altera a carta original', () => {
    schedule(card, 3, now)
    expect(card).toEqual(newCardState())
  })
})

describe('revisões', () => {
  it('Bom multiplica pelo fator de facilidade', () => {
    expect(schedule(review(10), 3, now, mid)).toMatchObject({ intervalDays: 25, ease: 2.5, due: midnightPlus(25) })
  })

  it('Difícil cresce 1,2× e reduz a facilidade; Fácil ganha bônus e aumenta', () => {
    expect(schedule(review(10), 2, now, mid)).toMatchObject({ intervalDays: 12, ease: 2.35 })
    expect(schedule(review(10), 4, now, mid)).toMatchObject({ intervalDays: 33, ease: 2.65 })
  })

  it('os intervalos ficam sempre em ordem: Difícil < Bom < Fácil', () => {
    for (const interval of [1, 2, 3, 7, 30, 200]) {
      const p = previewIntervals(review(interval, 1.3), now)
      expect(p[2]).toBeLessThan(p[3])
      expect(p[3]).toBeLessThan(p[4])
    }
  })

  it('revisar atrasado conta parte do atraso', () => {
    const onTime = schedule(review(10), 3, now, mid).intervalDays
    const late = schedule(review(10, 2.5, 6), 3, now, mid).intervalDays
    expect(late).toBe(Math.round((10 + 3) * 2.5))
    expect(late).toBeGreaterThan(onTime)
  })

  it('Errei vira lapso: reaprendizado de 10 min, facilidade −0,2 e volta com 1 dia', () => {
    const lapsed = schedule(review(30), 1, now)
    expect(lapsed).toMatchObject({ state: 'relearning', step: 0, lapses: 1, ease: 2.3, intervalDays: 1, due: now + 10 * MIN })
    expect(schedule(lapsed, 3, now + 10 * MIN)).toMatchObject({ state: 'review', intervalDays: 1 })
  })

  it('a facilidade nunca cai abaixo de 1,3 e o intervalo respeita o máximo', () => {
    expect(schedule(review(10, 1.35), 2, now, mid).ease).toBe(1.3)
    expect(schedule(review(30000, 2.5), 4, now, mid).intervalDays).toBe(36500)
  })

  it('a variação aleatória fica perto do intervalo calculado', () => {
    const low = schedule(review(10), 3, now, { random: () => 0 }).intervalDays
    const high = schedule(review(10), 3, now, { random: () => 0.999 }).intervalDays
    expect(low).toBeGreaterThanOrEqual(21)
    expect(high).toBeLessThanOrEqual(29)
    expect(low).toBeLessThan(high)
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
