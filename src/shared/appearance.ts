/**
 * Aparência da interface: tema (fundo), cor de destaque, tamanho, cantos, fonte e animações.
 * Partes puras (paletas, contraste, estilos prontos); quem aplica no documento é o renderer.
 */

export type ThemeId = 'system' | 'dark' | 'midnight' | 'navy' | 'light' | 'paper'
export type AccentId = 'blue' | 'purple' | 'cyan' | 'green' | 'amber' | 'orange' | 'pink' | 'graphite'
export type Density = 'compact' | 'normal' | 'large'
export type Corners = 'square' | 'normal' | 'round'
export type FontStyle = 'sans' | 'serif'

export interface Appearance {
  theme: ThemeId
  accent: AccentId
  density: Density
  corners: Corners
  font: FontStyle
  reduceMotion: boolean
}

export const DEFAULT_APPEARANCE: Appearance = { theme: 'dark', accent: 'blue', density: 'normal', corners: 'normal', font: 'sans', reduceMotion: false }

/** Temas de fundo; `mode` diz se a paleta é clara ou escura (afeta a cor de destaque e os controles nativos). */
export const THEMES: { id: Exclude<ThemeId, 'system'>; label: string; mode: 'dark' | 'light'; swatch: [string, string] }[] = [
  { id: 'dark', label: 'Grafite', mode: 'dark', swatch: ['#0b0b0f', '#1b1b24'] },
  { id: 'midnight', label: 'Meia-noite', mode: 'dark', swatch: ['#000000', '#141418'] },
  { id: 'navy', label: 'Azul-marinho', mode: 'dark', swatch: ['#0a1020', '#16213a'] },
  { id: 'light', label: 'Claro', mode: 'light', swatch: ['#f7f7fa', '#ffffff'] },
  { id: 'paper', label: 'Papel', mode: 'light', swatch: ['#f4efe4', '#fbf8f1'] }
]

/** Cada cor tem um tom para fundo escuro (mais claro) e outro para fundo claro (mais escuro). */
export const ACCENTS: { id: AccentId; label: string; dark: string; light: string }[] = [
  { id: 'blue', label: 'Azul', dark: '#4f8cff', light: '#1d5fe0' },
  { id: 'purple', label: 'Roxo', dark: '#8b5cf6', light: '#7c3aed' },
  { id: 'cyan', label: 'Ciano', dark: '#22c3ee', light: '#0e7490' },
  { id: 'green', label: 'Verde', dark: '#34d399', light: '#047857' },
  { id: 'amber', label: 'Âmbar', dark: '#fbbf24', light: '#b45309' },
  { id: 'orange', label: 'Laranja', dark: '#fb923c', light: '#c2410c' },
  { id: 'pink', label: 'Rosa', dark: '#f472b6', light: '#be185d' },
  { id: 'graphite', label: 'Grafite', dark: '#d4d4d8', light: '#3f3f46' }
]

export const DENSITIES: { id: Density; label: string; rootPx: number }[] = [
  { id: 'compact', label: 'Compacta', rootPx: 14 },
  { id: 'normal', label: 'Padrão', rootPx: 16 },
  { id: 'large', label: 'Grande', rootPx: 18 }
]

export const CORNERS: { id: Corners; label: string }[] = [
  { id: 'square', label: 'Retos' },
  { id: 'normal', label: 'Arredondados' },
  { id: 'round', label: 'Bem redondos' }
]

export const FONTS: { id: FontStyle; label: string }[] = [
  { id: 'sans', label: 'Sem serifa' },
  { id: 'serif', label: 'Com serifa (leitura)' }
]

/** Estilos prontos: combinam tudo de uma vez; dá para ajustar cada parte depois. */
export const PRESETS: { id: string; label: string; description: string; values: Appearance }[] = [
  { id: 'tramotak', label: 'Tramotak', description: 'O visual padrão, escuro com o azul do ícone', values: DEFAULT_APPEARANCE },
  {
    id: 'focus',
    label: 'Foco',
    description: 'Preto total, poucas cores, compacto e sem animações',
    values: { theme: 'midnight', accent: 'graphite', density: 'compact', corners: 'square', font: 'sans', reduceMotion: true }
  },
  {
    id: 'night',
    label: 'Noturno azul',
    description: 'Azul-marinho com ciano e cantos bem redondos',
    values: { theme: 'navy', accent: 'cyan', density: 'normal', corners: 'round', font: 'sans', reduceMotion: false }
  },
  {
    id: 'reading',
    label: 'Leitura',
    description: 'Fundo de papel, letra com serifa e tudo um pouco maior',
    values: { theme: 'paper', accent: 'amber', density: 'large', corners: 'normal', font: 'serif', reduceMotion: false }
  },
  {
    id: 'light',
    label: 'Claro',
    description: 'Fundo claro e azul, para ambientes iluminados',
    values: { theme: 'light', accent: 'blue', density: 'normal', corners: 'normal', font: 'sans', reduceMotion: false }
  }
]

const pick = <T extends string>(value: unknown, allowed: readonly { id: T }[] | readonly T[], fallback: T): T => {
  const ids = (allowed as readonly (T | { id: T })[]).map((a) => (typeof a === 'string' ? a : a.id))
  return ids.includes(value as T) ? (value as T) : fallback
}

/** Lê preferências guardadas (podem estar incompletas, antigas ou corrompidas). */
export function normalizeAppearance(input: unknown): Appearance {
  const a = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof Appearance, unknown>>
  return {
    theme: pick(a.theme, ['system', 'dark', 'midnight', 'navy', 'light', 'paper'] as const, DEFAULT_APPEARANCE.theme),
    accent: pick(a.accent, ACCENTS, DEFAULT_APPEARANCE.accent),
    density: pick(a.density, DENSITIES, DEFAULT_APPEARANCE.density),
    corners: pick(a.corners, CORNERS, DEFAULT_APPEARANCE.corners),
    font: pick(a.font, FONTS, DEFAULT_APPEARANCE.font),
    reduceMotion: a.reduceMotion === true
  }
}

/** Tema efetivo: "sistema" vira Grafite ou Claro conforme o sistema operacional. */
export function resolveTheme(theme: ThemeId, systemPrefersLight: boolean): Exclude<ThemeId, 'system'> {
  if (theme !== 'system') return theme
  return systemPrefersLight ? 'light' : 'dark'
}

export function themeMode(theme: Exclude<ThemeId, 'system'>): 'dark' | 'light' {
  return THEMES.find((t) => t.id === theme)?.mode ?? 'dark'
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

/** Luminância relativa (WCAG). */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Variáveis CSS da cor de destaque para o modo do tema: o tom, o fundo suave e a cor do texto por cima. */
export function accentVars(accent: AccentId, mode: 'dark' | 'light'): Record<'--accent' | '--accent-soft' | '--on-accent', string> {
  const def = ACCENTS.find((a) => a.id === accent) ?? ACCENTS[0]
  const color = mode === 'dark' ? def.dark : def.light
  const [r, g, b] = rgb(color)
  // Texto branco ou quase preto, o que tiver mais contraste com a cor.
  const onAccent = contrast(color, '#ffffff') >= contrast(color, '#0b0b0f') ? '#ffffff' : '#0b0b0f'
  return { '--accent': color, '--accent-soft': `rgb(${r} ${g} ${b} / ${mode === 'dark' ? 0.16 : 0.12})`, '--on-accent': onAccent }
}
