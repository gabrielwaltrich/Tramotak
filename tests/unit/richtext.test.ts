import { describe, expect, it } from 'vitest'
import { splitMath } from '@shared/math'

describe('splitMath', () => {
  it('separa fórmulas inline e em bloco', () => {
    expect(splitMath('Derivada de $x^2$ é $$2x$$.')).toEqual([
      { kind: 'text', value: 'Derivada de ' },
      { kind: 'math', value: 'x^2', display: false },
      { kind: 'text', value: ' é ' },
      { kind: 'math', value: '2x', display: true },
      { kind: 'text', value: '.' }
    ])
  })

  it('cifrão escapado e preço sem par não viram fórmula', () => {
    expect(splitMath('Custa \\$5 e \\$10')).toEqual([{ kind: 'text', value: 'Custa $5 e $10' }])
    expect(splitMath('só um $ aqui')).toEqual([{ kind: 'text', value: 'só um $ aqui' }])
  })
})
