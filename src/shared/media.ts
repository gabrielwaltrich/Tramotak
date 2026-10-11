/** Esquema do protocolo que serve arquivos dos cursos ao renderer. */
export const MEDIA_SCHEME = 'tramotak-media'

export const mediaUrl = {
  lesson: (id: number) => `${MEDIA_SCHEME}://lesson/${id}`,
  asset: (id: number) => `${MEDIA_SCHEME}://asset/${id}`
}

/** Extrai o alvo de uma URL do protocolo; `null` se não for válida. */
export function parseMediaUrl(url: string): { type: 'lesson' | 'asset'; id: number } | null {
  const match = new RegExp(`^${MEDIA_SCHEME}://(lesson|asset)/(\\d+)/?$`).exec(url)
  if (!match) return null
  return { type: match[1] as 'lesson' | 'asset', id: Number(match[2]) }
}
