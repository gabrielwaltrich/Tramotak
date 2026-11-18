import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACCENTS, THEMES, contrast } from '../../src/shared/appearance'

// Lê as paletas dos temas direto do CSS, para o teste acompanhar qualquer mudança de cor.
const css = readFileSync(join(__dirname, '../../src/renderer/src/styles/index.css'), 'utf8')
const palettes: Record<string, Record<string, string>> = {}
for (const m of css.matchAll(/:root(?:\[data-theme='(\w+)'\])?\s*\{([^}]*)\}/g)) {
  const vars: Record<string, string> = {}
  for (const v of m[2].matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[v[1]] = v[2].trim()
  palettes[m[1] ?? 'dark'] = { ...(m[1] ? palettes.dark : {}), ...vars }
}

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const mix = (fg: string, bg: string, a: number) => {
  const [f, b] = [rgb(fg), rgb(bg)]
  return '#' + f.map((c, i) => Math.round(c * a + b[i] * (1 - a)).toString(16).padStart(2, '0')).join('')
}

describe('contraste (WCAG AA, 4,5:1) em todos os temas e cores de destaque', () => {
  for (const theme of THEMES) {
    const p = palettes[theme.id]
    it(`${theme.label}: texto, texto suave e destaque sobre fundos e fundo suave`, () => {
      const alpha = theme.mode === 'dark' ? 0.16 : 0.12
      const failures: string[] = []
      for (const bg of ['bg', 'surface', 'surface-2']) {
        for (const key of ['text', 'text-muted']) {
          const r = contrast(p[key], p[bg])
          if (r < 4.5) failures.push(`${key} em ${bg}: ${r.toFixed(2)}`)
        }
        for (const a of ACCENTS) {
          const color = theme.mode === 'dark' ? a.dark : a.light
          const soft = mix(color, p[bg], alpha)
          for (const [name, fg, back] of [
            ['destaque', color, p[bg]],
            ['destaque no fundo suave', color, soft],
            ['texto suave no fundo suave', p['text-muted'], soft]
          ] as const) {
            const r = contrast(fg, back)
            if (r < 4.5) failures.push(`${a.label} ${name} sobre ${bg}: ${r.toFixed(2)}`)
          }
        }
      }
      expect(failures).toEqual([])
    })
  }
})
