import { describe, expect, it } from 'vitest'
import { greeting } from '@shared/greeting'

describe('greeting', () => {
  it.each([
    [5, 'Bom dia'],
    [11, 'Bom dia'],
    [12, 'Boa tarde'],
    [17, 'Boa tarde'],
    [18, 'Boa noite'],
    [0, 'Boa noite'],
    [4, 'Boa noite']
  ])('às %ih diz "%s"', (hour, expected) => {
    expect(greeting(hour)).toBe(expected)
  })
})
