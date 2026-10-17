/**
 * PDFs no leitor do app: grifos (em fração da página, para valer em qualquer zoom), referência ao PDF (a própria
 * aula ou um anexo, pelo caminho dentro do curso) e o texto por página usado pela IA. Lógica pura.
 */

/** Qual PDF: o da própria aula (`assetPath` nulo) ou um anexo dela. */
export interface PdfRef {
  lessonId: number
  assetPath: string | null
}

export interface PdfRect {
  x: number
  y: number
  w: number
  h: number
}

/** `fill`: o grifo sobre a página (translúcido); `swatch`: a bolinha da cor nos menus. */
export const HIGHLIGHT_COLORS = [
  { id: 'yellow', label: 'Amarelo', fill: 'rgb(250 204 21 / 0.38)', swatch: '#facc15' },
  { id: 'green', label: 'Verde', fill: 'rgb(74 222 128 / 0.35)', swatch: '#4ade80' },
  { id: 'blue', label: 'Azul', fill: 'rgb(96 165 250 / 0.35)', swatch: '#60a5fa' },
  { id: 'pink', label: 'Rosa', fill: 'rgb(244 114 182 / 0.35)', swatch: '#f472b6' }
] as const

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]['id']

export const isHighlightColor = (v: unknown): v is HighlightColor => HIGHLIGHT_COLORS.some((c) => c.id === v)

export const highlightFill = (color: string): string => (HIGHLIGHT_COLORS.find((c) => c.id === color) ?? HIGHLIGHT_COLORS[0]).fill

export interface PdfHighlight {
  id: number
  lessonId: number
  assetPath: string | null
  page: number
  rects: PdfRect[]
  text: string
  color: HighlightColor
  createdAt: number
}

export interface NewHighlight {
  lessonId: number
  assetPath: string | null
  page: number
  rects: PdfRect[]
  text: string
  color: HighlightColor
}

export const MAX_HIGHLIGHT_RECTS = 300
export const MAX_HIGHLIGHT_TEXT = 5000

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** Valida retângulos vindos da interface: números finitos, dentro da página, sem área nula. */
export function normalizeRects(raw: unknown): PdfRect[] {
  if (!Array.isArray(raw)) return []
  const out: PdfRect[] = []
  for (const r of raw.slice(0, MAX_HIGHLIGHT_RECTS)) {
    const { x, y, w, h } = (r ?? {}) as Record<string, unknown>
    if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) continue
    const left = clamp01(x as number)
    const top = clamp01(y as number)
    const width = clamp01((x as number) + (w as number)) - left
    const height = clamp01((y as number) + (h as number)) - top
    if (width > 0.0005 && height > 0.0005) out.push({ x: left, y: top, w: width, h: height })
  }
  return out
}

/**
 * Junta os retângulos da seleção que estão na mesma linha (o navegador devolve um por trecho de texto, muitas vezes
 * sobrepostos), para o grifo não ficar com faixas mais escuras onde eles se cruzam.
 */
export function mergeRects(rects: PdfRect[]): PdfRect[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x)
  const out: PdfRect[] = []
  for (const r of sorted) {
    const last = out.at(-1)
    const sameLine = last && Math.abs(last.y + last.h / 2 - (r.y + r.h / 2)) < Math.min(last.h, r.h) / 2
    const touching = last && r.x <= last.x + last.w + Math.max(last.h, r.h) * 0.5
    if (last && sameLine && touching) {
      const top = Math.min(last.y, r.y)
      const right = Math.max(last.x + last.w, r.x + r.w)
      const bottom = Math.max(last.y + last.h, r.y + r.h)
      last.y = top
      last.w = right - last.x
      last.h = bottom - top
    } else out.push({ ...r })
  }
  return out
}

/** Texto de uma página do PDF: junta os trechos, tira hifenização de fim de linha e espaços repetidos. */
export function cleanPageText(items: { str: string; hasEOL?: boolean }[]): string {
  return items
    .map((i) => i.str + (i.hasEOL ? '\n' : ''))
    .join('')
    .replace(/-\n(?=\p{Ll})/gu, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Texto de todas as páginas, sem marcação (material da geração). */
export function pdfPlainText(pages: string[]): string {
  return pages.filter((p) => p.trim()).join('\n\n')
}

/** Texto com a página antes de cada uma, para a conversa poder citar "[p. 12]". */
export function pdfTextWithPages(pages: string[]): string {
  return pages
    .map((text, i) => (text.trim() ? `[p. ${i + 1}]\n${text.trim()}` : ''))
    .filter(Boolean)
    .join('\n\n')
}

/** "[p. 12]" ou "[pp. 3-4]" → 12 / 3. */
export const PAGE_REF = /\[(?:p|pp|pág|página)\.?\s*(\d{1,5})(?:\s*[-–]\s*\d{1,5})?\]/gi

/** Link interno que abre a aula numa página (do PDF da aula ou de um anexo). */
export function pageLink(lessonId: number, page: number, assetPath: string | null = null): string {
  return `#/lesson/${lessonId}?p=${page}${assetPath ? `&a=${encodeURIComponent(assetPath)}` : ''}`
}

export const isPdfPath = (path: string): boolean => /\.pdf$/i.test(path)
