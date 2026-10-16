import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { MEDIA_SCHEME, parseMediaUrl } from '@shared/media'
import type { Database } from '../db/database'
import { assetFilePath, lessonFilePath } from '../db/lessons'
import { getTranscript } from '../db/media'
import { segmentsToVtt } from '@shared/media'
import { srtToVtt } from '../scanner/subtitles'
import { contentTypeFor, parseRange } from './range'

/** Precisa rodar antes de `app.ready`. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }
  ])
}

const CORS = { 'Access-Control-Allow-Origin': '*' }

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS } })
}

export async function serveFile(path: string, rangeHeader: string | null): Promise<Response> {
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) return text(404, 'Arquivo não encontrado no disco')

  const type = contentTypeFor(path)

  // Legendas: SRT vira WebVTT, que é o único formato aceito pelo <track>.
  if (extname(path).toLowerCase() === '.srt') {
    const vtt = srtToVtt(await readFile(path, 'utf8'))
    return new Response(vtt, { headers: { 'Content-Type': type, ...CORS } })
  }

  const range = parseRange(rangeHeader, info.size)
  if (range === 'invalid') {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}`, ...CORS } })
  }

  const start = range?.start ?? 0
  const end = range?.end ?? info.size - 1
  const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
  const headers: Record<string, string> = {
    'Content-Type': type,
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes',
    ...CORS
  }
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`
  return new Response(info.size === 0 ? null : stream, { status: range ? 206 : 200, headers })
}

export function handleMediaProtocol(db: Database, convertedDir: string): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const target = parseMediaUrl(request.url)
    if (!target) return text(400, 'URL inválida')
    try {
      if (target.type === 'transcript') {
        const transcript = getTranscript(db, target.id)
        if (!transcript) return text(404, 'Sem transcrição')
        return new Response(segmentsToVtt(transcript.segments), { headers: { 'Content-Type': 'text/vtt; charset=utf-8', ...CORS } })
      }
      const path = target.type === 'lesson' ? lessonFilePath(db, target.id, convertedDir) : assetFilePath(db, target.id)
      return await serveFile(path, request.headers.get('range'))
    } catch (error) {
      return text(404, error instanceof Error ? error.message : 'Não encontrado')
    }
  })
}
