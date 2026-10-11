import { INK_WIDTH, type Page } from '@shared/notebooks'
import { renderMarkdown } from '../../lib/markdown'
import { PAPER, strokePath, strokeWidth } from './InkBlock'

const LABEL = { course: 'Curso', lesson: 'Aula', deck: 'Baralho', bank: 'Banco de questões' } as const

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** HTML autossuficiente e em tema claro para imprimir o caderno (fórmulas em MathML, sem fontes externas). */
export function notebookHtml(title: string, pages: Page[]): string {
  const body = pages
    .map((p) => {
      const blocks = p.blocks
        .map((b) => {
          if (b.type === 'text') return b.text.trim() ? `<div class="text">${renderMarkdown(b.text, 'mathml')}</div>` : ''
          if (b.type === 'ink') {
            const paths = b.strokes
              .map((s) => `<path d="${strokePath(s.points)}" stroke="${s.color}" stroke-width="${strokeWidth(s).toFixed(2)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`)
              .join('')
            return `<svg class="ink" viewBox="0 0 ${INK_WIDTH} ${b.height}" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`
          }
          return `<div class="resource"><span>${LABEL[b.resource.kind]}</span> ${escape(b.resource.title)}</div>`
        })
        .join('')
      return `<section><h1>${escape(p.title)}</h1>${blocks}</section>`
    })
    .join('')

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escape(title)}</title><style>
    body { font: 11pt/1.6 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; margin: 0; }
    section + section { break-before: page; }
    h1 { font-size: 18pt; margin: 0 0 12pt; padding-bottom: 6pt; border-bottom: 1px solid #ddd; }
    .text h1 { font-size: 15pt; border: 0; padding: 0; } .text h2 { font-size: 13pt; } .text h3 { font-size: 11.5pt; }
    .text p { margin: 6pt 0; } .text ul, .text ol { padding-left: 18pt; }
    .text blockquote { border-left: 3px solid #ccc; margin: 6pt 0; padding-left: 10pt; color: #555; }
    .text code { background: #f3f3f3; padding: 1px 4px; border-radius: 3px; font-size: 9.5pt; }
    .text pre { background: #f3f3f3; padding: 8pt; border-radius: 4px; white-space: pre-wrap; }
    .text table { border-collapse: collapse; } .text td, .text th { border: 1px solid #ccc; padding: 3pt 6pt; }
    .text a { color: #5b21b6; }
    .ink { display: block; width: 100%; background: ${PAPER}; border: 1px solid #e5e5e5; border-radius: 4px; margin: 8pt 0; break-inside: avoid; }
    .resource { border: 1px solid #ddd; border-radius: 6px; padding: 6pt 10pt; margin: 8pt 0; }
    .resource span { color: #777; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.05em; margin-right: 6pt; }
    math[display="block"] { margin: 8pt 0; }
  </style></head><body>${body}</body></html>`
}
