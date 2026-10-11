import { describe, expect, it } from 'vitest'
import { FSRSAlgorithm, generatorParameters } from 'ts-fsrs'
import { FSRS_PARAMS, intervalFor, nextMemory, retrievability, type Rating } from '@shared/srs'

/** Confere as fórmulas do FSRS-6 com a implementação de referência (ts-fsrs, só nos testes). */
describe('FSRS-6 igual à referência', () => {
  const reference = new FSRSAlgorithm(generatorParameters({ w: [...FSRS_PARAMS], enable_short_term: true }))

  it('parâmetros padrão são os do ts-fsrs', () => {
    expect([...FSRS_PARAMS]).toEqual([...generatorParameters().w])
  })

  it('memória inicial e atualizações batem em milhares de combinações', () => {
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 3000; i++) {
      const s = 0.1 + rand() * 400
      const d = 1 + rand() * 9
      const t = i % 5 === 0 ? 0 : Math.floor(rand() * 500)
      const g = (1 + Math.floor(rand() * 4)) as Rating
      const ours = nextMemory({ stability: s, difficulty: d }, t, g)
      const theirs = reference.next_state({ stability: s, difficulty: d }, t, g)
      // Diferenças só de arredondamento (o ts-fsrs arredonda passos intermediários em 8 casas).
      expect(Math.abs(ours.stability - theirs.stability) / theirs.stability).toBeLessThan(1e-6)
      expect(ours.difficulty).toBeCloseTo(theirs.difficulty, 5)
    }
    for (const g of [1, 2, 3, 4] as Rating[]) {
      const theirs = reference.next_state(null, 0, g)
      const ours = nextMemory(null, 0, g)
      expect(ours.stability).toBeCloseTo(theirs.stability, 6)
      expect(ours.difficulty).toBeCloseTo(theirs.difficulty, 6)
    }
  })

  it('curva de esquecimento e intervalo', () => {
    expect(retrievability(10, 10)).toBeCloseTo(0.9, 10)
    expect(retrievability(37, 12)).toBeCloseTo(reference.forgetting_curve(37, 12), 6)
    expect(intervalFor(10, 0.9)).toBeCloseTo(10, 8)
    for (const [s, retention] of [[25, 0.8], [3.7, 0.95], [140, 0.9], [60, 0.7]]) {
      const algorithm = new FSRSAlgorithm(generatorParameters({ request_retention: retention, enable_fuzz: false }))
      expect(Math.round(intervalFor(s, retention))).toBe(algorithm.next_interval(s, 0))
    }
  })
})
