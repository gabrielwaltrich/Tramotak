import { describe, expect, it } from 'vitest'
import { ACCENTS, accentVars, contrast, DEFAULT_APPEARANCE, normalizeAppearance, PRESETS, resolveTheme, themeMode, THEMES } from '@shared/appearance'

describe('aparência', () => {
  it('o padrão é o escuro com o azul do ícone', () => {
    expect(DEFAULT_APPEARANCE).toMatchObject({ theme: 'dark', accent: 'blue' })
    expect(PRESETS[0].values).toEqual(DEFAULT_APPEARANCE)
  })

  it('preferências antigas, incompletas ou inválidas viram valores válidos', () => {
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE)
    expect(normalizeAppearance({ theme: 'light', accent: 'roxo-neon', density: 'enorme', reduceMotion: 'sim' })).toEqual({ ...DEFAULT_APPEARANCE, theme: 'light' })
    expect(normalizeAppearance({ theme: 'paper', accent: 'amber', density: 'large', corners: 'round', font: 'serif', reduceMotion: true })).toEqual({
      theme: 'paper',
      accent: 'amber',
      density: 'large',
      corners: 'round',
      font: 'serif',
      reduceMotion: true
    })
  })

  it('"sistema" segue o sistema; cada tema sabe se é claro ou escuro', () => {
    expect(resolveTheme('system', true)).toBe('light')
    expect(resolveTheme('system', false)).toBe('dark')
    expect(resolveTheme('navy', true)).toBe('navy')
    expect(themeMode('paper')).toBe('light')
    expect(themeMode('midnight')).toBe('dark')
  })

  it('o texto sobre a cor de destaque tem contraste suficiente em todas as combinações', () => {
    for (const a of ACCENTS) {
      for (const mode of ['dark', 'light'] as const) {
        const v = accentVars(a.id, mode)
        // Botões têm texto pequeno: pelo menos 4,5:1 (WCAG AA)
        expect(contrast(v['--accent'], v['--on-accent']), `${a.id}/${mode}`).toBeGreaterThanOrEqual(4.5)
      }
    }
    expect(accentVars('amber', 'dark')['--on-accent']).toBe('#0b0b0f')
    expect(accentVars('blue', 'light')['--on-accent']).toBe('#ffffff')
  })

  it('a cor de destaque se destaca do fundo de cada tema (pelo menos 3:1)', () => {
    for (const t of THEMES) {
      for (const a of ACCENTS) {
        const color = accentVars(a.id, t.mode)['--accent']
        expect(contrast(color, t.swatch[0]), `${a.id} em ${t.id}`).toBeGreaterThanOrEqual(3)
      }
    }
  })
})
