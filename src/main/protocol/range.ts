import { extname } from 'node:path'

export type ByteRange = { start: number; end: number }

/**
 * Interpreta um cabeçalho `Range: bytes=...` para um arquivo de `size` bytes.
 * `null` = sem Range (serve tudo); `'invalid'` = fora do arquivo (responder 416).
 * Só um intervalo é suportado; múltiplos intervalos usam o primeiro.
 */
export function parseRange(header: string | null, size: number): ByteRange | null | 'invalid' {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)/.exec(header.trim())
  if (!match) return 'invalid'
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return 'invalid'

  let start: number
  let end: number
  if (rawStart === '') {
    // bytes=-500 → últimos 500 bytes
    const suffix = Number(rawEnd)
    if (suffix === 0) return 'invalid'
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  }
  if (start >= size || start > end) return 'invalid'
  return { start, end }
}

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/mp4', // QuickTime com H.264 costuma tocar quando anunciado como MP4
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.vtt': 'text/vtt; charset=utf-8',
  '.srt': 'text/vtt; charset=utf-8', // convertido na hora
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg'
}

export function contentTypeFor(path: string): string {
  return TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}
