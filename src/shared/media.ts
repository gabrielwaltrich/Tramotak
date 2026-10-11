/** Esquema do protocolo que serve arquivos dos cursos ao renderer. */
export const MEDIA_SCHEME = 'tramotak-media'

export const mediaUrl = {
  /** `version` muda quando o vídeo é convertido, para o player não usar o arquivo antigo em cache. */
  lesson: (id: number, version?: number | null) => `${MEDIA_SCHEME}://lesson/${id}${version ? `?v=${version}` : ''}`,
  asset: (id: number) => `${MEDIA_SCHEME}://asset/${id}`,
  transcript: (lessonId: number, version?: number | null) => `${MEDIA_SCHEME}://transcript/${lessonId}${version ? `?v=${version}` : ''}`
}

/** Extrai o alvo de uma URL do protocolo; `null` se não for válida. */
export function parseMediaUrl(url: string): { type: 'lesson' | 'asset' | 'transcript'; id: number } | null {
  const match = new RegExp(`^${MEDIA_SCHEME}://(lesson|asset|transcript)/(\\d+)/?(\\?[^#]*)?$`).exec(url)
  if (!match) return null
  return { type: match[1] as 'lesson' | 'asset' | 'transcript', id: Number(match[2]) }
}

// ── Formatos de vídeo ───────────────────────────────────────────────────────

export interface ProbeResult {
  durationSec: number | null
  /** Contêiner como o FFmpeg nomeia (ex.: "mov,mp4,m4a,3gp,3g2,mj2", "matroska,webm"). */
  container: string | null
  videoCodec: string | null
  audioCodec: string | null
}

/** Codecs que o Chromium do Electron toca. */
const VIDEO_OK = new Set(['h264', 'vp8', 'vp9', 'av1'])
const AUDIO_OK = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac'])
const CONTAINER_OK = ['mov', 'mp4', 'webm', 'matroska']

export type ConversionPlan = 'none' | 'remux' | 'audio' | 'full'

export interface Compatibility {
  playable: boolean
  plan: ConversionPlan
  reason: string
}

/**
 * Interpreta a saída de `ffmpeg -hide_banner -i arquivo` (stderr). Usar o próprio FFmpeg
 * evita embutir também o ffprobe.
 */
export function parseProbe(stderr: string): ProbeResult {
  const duration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
  const container = /Input #0,\s*([^,]+(?:,[^,\s]+)*),\s*from/.exec(stderr)
  const stream = (kind: 'Video' | 'Audio') => new RegExp(`Stream #0:\\d+[^:]*:\\s*${kind}:\\s*([a-z0-9_]+)`, 'i').exec(stderr)?.[1]?.toLowerCase() ?? null
  return {
    durationSec: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : null,
    container: container?.[1].trim() ?? null,
    videoCodec: stream('Video'),
    audioCodec: stream('Audio')
  }
}

/** Decide o que fazer para o vídeo tocar no app, do mais barato ao mais caro. */
export function compatibility(probe: ProbeResult): Compatibility {
  const videoOk = probe.videoCodec !== null && VIDEO_OK.has(probe.videoCodec)
  const audioOk = probe.audioCodec === null || AUDIO_OK.has(probe.audioCodec)
  const containerOk = probe.container !== null && CONTAINER_OK.some((c) => probe.container!.split(',').includes(c))
  if (probe.videoCodec === null) return { playable: false, plan: 'none', reason: 'Nenhuma faixa de vídeo encontrada' }
  if (!videoOk) return { playable: false, plan: 'full', reason: `Vídeo em ${probe.videoCodec.toUpperCase()}, que o player não toca` }
  if (!audioOk) return { playable: false, plan: 'audio', reason: `Áudio em ${probe.audioCodec!.toUpperCase()}, que o player não toca` }
  if (!containerOk) return { playable: false, plan: 'remux', reason: `Formato ${probe.container ?? 'desconhecido'} não suportado` }
  return { playable: true, plan: 'none', reason: 'Compatível' }
}

/** Progresso do `-progress pipe:1` do FFmpeg ("out_time_us=12345678"), de 0 a 1. */
export function progressFrom(line: string, durationSec: number | null): number | null {
  const m = /^out_time_(?:us|ms)=(\d+)/.exec(line.trim())
  if (!m || !durationSec) return null
  return Math.min(1, Math.max(0, Number(m[1]) / 1_000_000 / durationSec))
}

// ── Transcrição ─────────────────────────────────────────────────────────────

export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

export type TranscriptionProvider = 'groq' | 'local'

export interface Transcript {
  lessonId: number
  provider: TranscriptionProvider
  model: string
  language: string
  segments: TranscriptSegment[]
  createdAt: number
}

function vttTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`
}

export function segmentsToVtt(segments: TranscriptSegment[]): string {
  const cues = segments
    .filter((s) => s.text.trim())
    .map((s, i) => `${i + 1}\n${vttTime(s.start)} --> ${vttTime(Math.max(s.end, s.start + 0.5))}\n${s.text.trim().replace(/-->/g, '→')}`)
  return `WEBVTT\n\n${cues.join('\n\n')}\n`
}

/** Junta trechos de vários pedaços de áudio, deslocando cada um pelo início do pedaço. */
export function offsetSegments(segments: { start: number; end: number; text: string }[], offsetSec: number): TranscriptSegment[] {
  return segments
    .map((s) => ({ start: Number(s.start) + offsetSec, end: Number(s.end) + offsetSec, text: String(s.text ?? '').trim() }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.text)
}

export function transcriptText(segments: TranscriptSegment[]): string {
  return segments.map((s) => s.text).join(' ')
}

// ── Fila de processamento ───────────────────────────────────────────────────

export type MediaJobKind = 'convert' | 'transcribe'

export interface MediaJob {
  id: number
  kind: MediaJobKind
  lessonId: number
  lessonTitle: string
  status: 'queued' | 'running' | 'done' | 'error' | 'canceled'
  /** 0 a 1. */
  progress: number
  error: string | null
}
