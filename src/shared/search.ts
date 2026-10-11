/** Texto normalizado para busca: minúsculo e sem acentos. */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/** Verdadeiro se todas as palavras da busca aparecem em algum dos campos. */
export function matches(query: string, ...fields: string[]): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = normalize(fields.join(' '))
  return words.every((w) => haystack.includes(w))
}
