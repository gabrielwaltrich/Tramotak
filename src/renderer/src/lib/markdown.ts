import DOMPurify from 'dompurify'
import katex from 'katex'
import { marked } from 'marked'
import { splitMath } from '@shared/math'

// Caracteres de uso privado: o parser de HTML preserva (NUL viraria "�").
const TOKEN = (i: number) => `\uE000MATH${i}\uE001`

/**
 * Markdown + LaTeX em HTML seguro. As fórmulas saem do texto antes do Markdown (para o `marked`
 * não mexer em `_` e `*` dentro delas), o HTML passa pelo DOMPurify e só então o KaTeX entra.
 * `math: 'mathml'` serve para o PDF, que não carrega as fontes do KaTeX.
 */
export function renderMarkdown(text: string, math: 'html' | 'mathml' = 'html'): string {
  const formulas: { value: string; display: boolean }[] = []
  const withTokens = splitMath(text)
    .map((p) => {
      if (p.kind === 'text') return p.value
      formulas.push({ value: p.value, display: p.display })
      return TOKEN(formulas.length - 1)
    })
    .join('')
  const html = marked.parse(withTokens, { async: false, gfm: true, breaks: true }) as string
  const safe = DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'iframe'], FORBID_ATTR: ['style'] })
  return safe.replace(/\uE000MATH(\d+)\uE001/g, (_m, i: string) => {
    const f = formulas[Number(i)]
    return f ? katex.renderToString(f.value, { displayMode: f.display, throwOnError: false, trust: false, strict: 'ignore', output: math }) : ''
  })
}

// Links do conteúdo abrem no navegador do sistema (o processo principal bloqueia navegação interna).
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})
