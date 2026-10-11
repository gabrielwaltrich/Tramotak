import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { offsetSegments, type TranscriptSegment } from '@shared/media'
import { extractAudio } from './ffmpeg'

export const GROQ_URL = 'https://api.groq.com/openai/v1'
/** Pedaços de 10 min: ~2,4 MB cada em 32 kb/s, bem abaixo do limite de upload dos provedores. */
export const CHUNK_SEC = 600

export interface TranscriberConfig {
  /** Base de uma API compatível com a da OpenAI (…/v1). */
  baseUrl: string
  apiKey: string | null
  model: string
  /** Código ISO ("pt") ou vazio para detectar. */
  language: string
}

function friendlyError(status: number, body: string): string {
  if (status === 401 || status === 403) return 'O provedor recusou a chave de API. Confira a chave nas Configurações.'
  if (status === 404) return 'Endereço do serviço de transcrição não encontrado. Confira a URL nas Configurações.'
  if (status === 413) return 'Áudio grande demais para o provedor.'
  if (status === 429) return 'Limite de uso do provedor atingido. Tente de novo mais tarde.'
  const detail = (() => {
    try {
      return (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? body
    } catch {
      return body
    }
  })()
  return `O provedor respondeu ${status}: ${detail.slice(0, 200)}`
}

/** Envia um arquivo de áudio e devolve os trechos com horário (resposta "verbose_json"). */
export async function transcribeChunk(file: string, config: TranscriberConfig, signal?: AbortSignal): Promise<{ start: number; end: number; text: string }[]> {
  const form = new FormData()
  form.append('file', new Blob([await readFile(file)], { type: 'audio/mpeg' }), 'audio.mp3')
  form.append('model', config.model)
  form.append('response_format', 'verbose_json')
  form.append('temperature', '0')
  if (config.language) form.append('language', config.language)

  let response: Response
  try {
    response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
      method: 'POST',
      body: form,
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : undefined,
      signal
    })
  } catch (error) {
    if (signal?.aborted) throw new Error('Cancelado', { cause: error })
    throw new Error(`Não foi possível conectar a ${new URL(config.baseUrl).host}: ${error instanceof Error ? error.message : error}`, { cause: error })
  }
  const body = await response.text()
  if (!response.ok) throw new Error(friendlyError(response.status, body))
  let data: { segments?: { start: number; end: number; text: string }[]; text?: string; duration?: number }
  try {
    data = JSON.parse(body)
  } catch {
    throw new Error('Resposta inesperada do serviço de transcrição')
  }
  if (Array.isArray(data.segments) && data.segments.length) return data.segments
  return data.text?.trim() ? [{ start: 0, end: data.duration ?? 0, text: data.text }] : []
}

/** Transcreve um vídeo inteiro em pedaços, mantendo os horários contínuos. */
export async function transcribeMedia(
  input: string,
  durationSec: number,
  config: TranscriberConfig,
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal; chunkSec?: number } = {}
): Promise<TranscriptSegment[]> {
  const chunk = options.chunkSec ?? CHUNK_SEC
  const total = Math.max(1, Math.ceil(durationSec / chunk))
  const dir = await mkdtemp(join(tmpdir(), 'tramotak-stt-'))
  const segments: TranscriptSegment[] = []
  try {
    for (let i = 0; i < total; i++) {
      if (options.signal?.aborted) throw new Error('Cancelado')
      const file = join(dir, `parte-${i}.mp3`)
      await extractAudio(input, file, i * chunk, chunk, options.signal)
      segments.push(...offsetSegments(await transcribeChunk(file, config, options.signal), i * chunk))
      options.onProgress?.((i + 1) / total)
    }
    return segments
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
