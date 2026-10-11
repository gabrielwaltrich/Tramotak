import { describe, expect, it } from 'vitest'
import { formatBytes, formatDuration, percent, plural } from '@shared/format'

describe('formatação', () => {
  it.each([
    [0, '0 s'],
    [45, '45 s'],
    [60, '1 min'],
    [3599, '59 min'],
    [3600, '1h00'],
    [11100, '3h05']
  ])('formatDuration(%i) = %s', (sec, expected) => expect(formatDuration(sec)).toBe(expected))

  it('formatBytes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1,5 KB')
    expect(formatBytes(5 * 1024 ** 3)).toBe('5 GB')
  })

  it('percent e plural', () => {
    expect(percent(1, 3)).toBe(33)
    expect(percent(0, 0)).toBe(0)
    expect(plural(1, 'aula')).toBe('1 aula')
    expect(plural(1200, 'aula')).toBe('1.200 aulas')
    expect(plural(2, 'módulo')).toBe('2 módulos')
  })
})

import { matches } from '@shared/search'

describe('matches', () => {
  it('ignora acentos e caixa e exige todas as palavras', () => {
    expect(matches('calculo', 'Cálculo I')).toBe(true)
    expect(matches('CÁLC i', 'Cálculo I')).toBe(true)
    expect(matches('calculo fisica', 'Cálculo I')).toBe(false)
    expect(matches('cursos', 'Cálculo', '/home/u/Cursos/calc')).toBe(true)
    expect(matches('   ', 'qualquer')).toBe(true)
  })
})
