import { describe, expect, it } from 'vitest'
import { NAV_FOOTER, NAV_ITEMS } from '@shared/nav'

describe('navegação', () => {
  const all = [...NAV_ITEMS, ...NAV_FOOTER]

  it('não repete rotas', () => {
    const paths = all.map((i) => i.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('libera Início, Meus Cursos e Configurações no M0', () => {
    const enabled = all.filter((i) => !i.soon).map((i) => i.path)
    expect(enabled).toEqual(['/', '/courses', '/settings'])
  })
})
