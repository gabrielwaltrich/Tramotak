const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Converte o HTML dos campos do Anki em texto simples, preservando as quebras de linha. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<img[^>]*>/gi, '[imagem]')
    .replace(/\[sound:[^\]]*\]/gi, '[áudio]')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
      if (code[0] === '#') {
        const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
        return Number.isFinite(n) ? String.fromCodePoint(n) : match
      }
      return ENTITIES[code.toLowerCase()] ?? match
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** `{{c1::Brasília::capital}}` → frente "[capital]", verso "Brasília". */
export function splitCloze(text: string): { front: string; back: string } | null {
  if (!/\{\{c\d+::/.test(text)) return null
  const re = /\{\{c\d+::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g
  return {
    front: text.replace(re, (_m, _answer: string, hint?: string) => `[${hint ?? '…'}]`),
    back: text.replace(re, (_m, answer: string) => answer)
  }
}
