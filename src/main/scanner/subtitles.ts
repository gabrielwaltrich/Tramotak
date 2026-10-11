import { extname } from 'node:path'

const LANG = /^[a-z]{2,3}(?:[-_][A-Za-z]{2,4})?$/

/**
 * Se `subtitle` pertence ao vídeo de nome-base `videoBase`, devolve o idioma
 * (`null` quando não há sufixo). Caso contrário, `undefined`.
 *   aula.srt → null · aula.pt.srt → "pt" · aula.pt-BR.vtt → "pt-BR"
 */
export function matchSubtitle(videoBase: string, subtitle: string): string | null | undefined {
  const base = subtitle.slice(0, subtitle.length - extname(subtitle).length)
  if (base === videoBase) return null
  if (!base.startsWith(videoBase + '.')) return undefined
  const suffix = base.slice(videoBase.length + 1)
  return LANG.test(suffix) ? suffix.replace('_', '-') : undefined
}

/** Converte SRT em WebVTT (o `<track>` do navegador só entende VTT). */
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
    .trim()
  return `WEBVTT\n\n${body}\n`
}
