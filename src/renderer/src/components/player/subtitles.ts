/** Rótulo de uma legenda: o idioma por extenso ("Português"), senão o nome do arquivo sem extensão. */
export function subtitleLabel(lang: string | null, name: string): string {
  if (!lang) return name.replace(/\.(srt|vtt)$/i, '')
  try {
    const display = new Intl.DisplayNames(['pt-BR'], { type: 'language' }).of(lang)
    return display ? display.charAt(0).toUpperCase() + display.slice(1) : lang
  } catch {
    return lang
  }
}

/** Índice da legenda preferida ('off' desliga; idioma ausente cai na primeira). */
export function preferredTrack(tracks: { lang: string | null }[], preferred: string): number {
  if (preferred === 'off' || tracks.length === 0) return -1
  return Math.max(tracks.findIndex((t) => (t.lang ?? '') === preferred), 0)
}
