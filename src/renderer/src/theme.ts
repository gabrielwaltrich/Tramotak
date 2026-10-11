import {
  accentVars,
  DENSITIES,
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  resolveTheme,
  themeMode,
  type Appearance
} from '@shared/appearance'
import { readPref, writePref } from './storage'

const KEY = 'tramotak.appearance'
/** Preferência da versão anterior (só claro/escuro/sistema). */
const LEGACY_KEY = 'tramotak.theme'

const prefersLight = () => window.matchMedia('(prefers-color-scheme: light)').matches

export function getAppearance(): Appearance {
  const stored = readPref(KEY)
  if (stored) {
    try {
      return normalizeAppearance(JSON.parse(stored))
    } catch {
      // preferência corrompida: volta ao padrão
    }
  }
  const legacy = readPref(LEGACY_KEY)
  return legacy === 'light' || legacy === 'system' ? { ...DEFAULT_APPEARANCE, theme: legacy } : DEFAULT_APPEARANCE
}

/** Aplica no documento: atributos para o CSS e variáveis da cor de destaque. */
function apply(appearance: Appearance): void {
  const root = document.documentElement
  const theme = resolveTheme(appearance.theme, prefersLight())
  const mode = themeMode(theme)
  root.dataset.theme = theme
  root.dataset.mode = mode
  root.dataset.corners = appearance.corners
  root.dataset.font = appearance.font
  root.dataset.motion = appearance.reduceMotion ? 'reduce' : 'full'
  for (const [name, value] of Object.entries(accentVars(appearance.accent, mode))) root.style.setProperty(name, value)
  // O Tailwind mede tudo em rem: mudar a fonte da raiz escala a interface inteira.
  root.style.fontSize = `${DENSITIES.find((d) => d.id === appearance.density)?.rootPx ?? 16}px`
}

export function setAppearance(appearance: Appearance): void {
  writePref(KEY, JSON.stringify(appearance))
  apply(appearance)
}

export function applyStoredAppearance(): void {
  apply(getAppearance())
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    const current = getAppearance()
    if (current.theme === 'system') apply(current)
  })
}
