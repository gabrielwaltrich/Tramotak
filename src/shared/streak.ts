/** Segundos mínimos de estudo para um dia contar na sequência. */
export const STREAK_MIN_SECONDS = 60

/** Chave do dia no fuso local: "2026-10-11". */
export function dayKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}

export interface Streak {
  /** Dias seguidos até hoje (ou até ontem, se hoje ainda não estudou). */
  current: number
  /** Se hoje já conta. Com `current > 0` e `false`, a sequência está viva mas em risco. */
  todayDone: boolean
  best: number
}

/** Calcula a sequência a partir dos dias (chaves locais) que atingiram o mínimo. */
export function computeStreak(activeDays: Set<string>, today: Date): Streak {
  const todayDone = activeDays.has(dayKey(today))
  let cursor = todayDone ? today : addDays(today, -1)
  let current = 0
  while (activeDays.has(dayKey(cursor))) {
    current++
    cursor = addDays(cursor, -1)
  }

  let best = 0
  for (const key of activeDays) {
    const [y, m, d] = key.split('-').map(Number)
    const start = new Date(y, m - 1, d)
    if (activeDays.has(dayKey(addDays(start, -1)))) continue // só conta a partir do início de cada sequência
    let length = 0
    let day = start
    while (activeDays.has(dayKey(day))) {
      length++
      day = addDays(day, 1)
    }
    best = Math.max(best, length)
  }
  return { current, todayDone, best: Math.max(best, current) }
}
