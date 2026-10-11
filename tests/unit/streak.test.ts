import { describe, expect, it } from 'vitest'
import { computeStreak, dayKey } from '@shared/streak'

const today = new Date(2026, 9, 11, 15, 0) // 11/10/2026, 15h local
const days = (...keys: string[]) => new Set(keys)

describe('dayKey', () => {
  it('usa a data local com zeros à esquerda', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})

describe('computeStreak', () => {
  it('sem estudo', () => {
    expect(computeStreak(days(), today)).toEqual({ current: 0, todayDone: false, best: 0 })
  })

  it('estudou hoje e nos dois dias anteriores', () => {
    expect(computeStreak(days('2026-10-09', '2026-10-10', '2026-10-11'), today)).toEqual({ current: 3, todayDone: true, best: 3 })
  })

  it('sequência viva até ontem, hoje ainda não', () => {
    expect(computeStreak(days('2026-10-09', '2026-10-10'), today)).toEqual({ current: 2, todayDone: false, best: 2 })
  })

  it('pular um dia zera a sequência atual, mas guarda o recorde', () => {
    const active = days('2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-09')
    expect(computeStreak(active, today)).toEqual({ current: 0, todayDone: false, best: 4 })
  })

  it('atravessa a virada de mês e de ano', () => {
    expect(computeStreak(days('2026-09-30', '2026-10-01'), new Date(2026, 9, 1)).current).toBe(2)
    expect(computeStreak(days('2025-12-31', '2026-01-01'), new Date(2026, 0, 1)).current).toBe(2)
  })
})
