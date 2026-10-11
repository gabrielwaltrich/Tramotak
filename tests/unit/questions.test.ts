import { describe, expect, it } from 'vitest'
import { grade, isAnswered, normalizeShort, shuffle, validateQuestion, type QuestionInput } from '@shared/questions'

const base = { explanation: '', topic: '', difficulty: 3, points: 2 }
const opts = [
  { id: 'a', text: '2x' },
  { id: 'b', text: 'x' },
  { id: 'c', text: '2' }
]

describe('grade', () => {
  it('múltipla escolha', () => {
    const q = { key: { type: 'single' as const, correct: 'a' }, points: 2 }
    expect(grade(q, { type: 'single', choice: 'a' })).toEqual({ correct: true, points: 2 })
    expect(grade(q, { type: 'single', choice: 'b' })).toEqual({ correct: false, points: 0 })
    expect(grade(q, { type: 'single', choice: null })).toEqual({ correct: false, points: 0 })
    expect(grade(q, null)).toEqual({ correct: false, points: 0 })
  })

  it('múltipla resposta é tudo ou nada, sem depender da ordem', () => {
    const q = { key: { type: 'multiple' as const, correct: ['a', 'c'] }, points: 1 }
    expect(grade(q, { type: 'multiple', choices: ['c', 'a'] }).correct).toBe(true)
    expect(grade(q, { type: 'multiple', choices: ['a'] }).correct).toBe(false)
    expect(grade(q, { type: 'multiple', choices: ['a', 'b', 'c'] }).correct).toBe(false)
  })

  it('verdadeiro ou falso', () => {
    const q = { key: { type: 'truefalse' as const, correct: false }, points: 1 }
    expect(grade(q, { type: 'truefalse', value: false }).correct).toBe(true)
    expect(grade(q, { type: 'truefalse', value: true }).correct).toBe(false)
  })

  it('resposta curta ignora acentos, maiúsculas e espaços, e aceita variações', () => {
    const q = { key: { type: 'short' as const, accepted: ['Brasília', 'DF'] }, points: 1 }
    expect(grade(q, { type: 'short', text: '  brasilia ' }).correct).toBe(true)
    expect(grade(q, { type: 'short', text: 'df' }).correct).toBe(true)
    expect(grade(q, { type: 'short', text: 'São Paulo' }).correct).toBe(false)
    expect(normalizeShort('  Ação   Rápida ')).toBe('acao rapida')
  })

  it('dissertativa respondida fica pendente; em branco vale zero', () => {
    const q = { key: { type: 'essay' as const, reference: '...' }, points: 3 }
    expect(grade(q, { type: 'essay', text: 'minha resposta' })).toEqual({ correct: null, points: 0 })
    expect(grade(q, { type: 'essay', text: '  ' })).toEqual({ correct: false, points: 0 })
  })

  it('resposta de outro tipo não conta', () => {
    expect(grade({ key: { type: 'single', correct: 'a' }, points: 1 }, { type: 'truefalse', value: true }).correct).toBe(false)
  })
})

describe('validateQuestion', () => {
  const single: QuestionInput = { ...base, type: 'single', statement: ' Derivada de $x^2$? ', options: opts, key: { type: 'single', correct: 'a' } }

  it('limpa e normaliza os campos', () => {
    const q = validateQuestion({ ...single, difficulty: 9, points: 0, topic: '  Cálculo ' })
    expect(q).toMatchObject({ statement: 'Derivada de $x^2$?', difficulty: 5, points: 1, topic: 'Cálculo' })
  })

  it('exige enunciado, duas alternativas e gabarito válido', () => {
    expect(() => validateQuestion({ ...single, statement: ' ' })).toThrow('enunciado')
    expect(() => validateQuestion({ ...single, options: [opts[0], { id: 'b', text: ' ' }] })).toThrow('duas alternativas')
    expect(() => validateQuestion({ ...single, key: { type: 'single', correct: 'z' } })).toThrow('correta')
    expect(() => validateQuestion({ ...single, type: 'multiple', key: { type: 'multiple', correct: [] } })).toThrow('pelo menos uma')
    expect(() => validateQuestion({ ...base, type: 'short', statement: 'x', options: [], key: { type: 'short', accepted: [' '] } })).toThrow('resposta aceita')
    expect(() => validateQuestion({ ...base, type: 'truefalse', statement: 'x', options: [], key: { type: 'essay', reference: '' } })).toThrow('verdadeira ou falsa')
  })

  it('tipos sem alternativas descartam as opções', () => {
    expect(validateQuestion({ ...base, type: 'truefalse', statement: 'x', options: opts, key: { type: 'truefalse', correct: true } }).options).toEqual([])
  })
})

describe('isAnswered e shuffle', () => {
  it('isAnswered', () => {
    expect(isAnswered({ type: 'multiple', choices: [] })).toBe(false)
    expect(isAnswered({ type: 'essay', text: 'ok' })).toBe(true)
    expect(isAnswered(undefined)).toBe(false)
  })

  it('shuffle mantém os itens e é determinístico com random fixo', () => {
    const items = [1, 2, 3, 4, 5]
    const out = shuffle(items, () => 0)
    expect([...out].sort()).toEqual(items)
    expect(out).toEqual(shuffle(items, () => 0))
    expect(items).toEqual([1, 2, 3, 4, 5])
  })
})
