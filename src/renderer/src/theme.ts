import { readPref, writePref } from './storage'

export type Theme = 'dark' | 'light' | 'system'

const KEY = 'tramotak.theme'

export function getStoredTheme(): Theme {
  const value = readPref(KEY)
  return value === 'light' || value === 'system' ? value : 'dark'
}

function resolve(theme: Theme): 'dark' | 'light' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function setTheme(theme: Theme): void {
  writePref(KEY, theme)
  document.documentElement.dataset.theme = resolve(theme)
}

export function applyStoredTheme(): void {
  const theme = getStoredTheme()
  document.documentElement.dataset.theme = resolve(theme)
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (getStoredTheme() === 'system') document.documentElement.dataset.theme = resolve('system')
  })
}
