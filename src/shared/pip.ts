/**
 * Janela flutuante (picture-in-picture) do player: preferências, mensagens entre o app e a janela, e as contas de
 * posição/tamanho. Lógica pura, usada pelo processo principal, pela janela flutuante e pelos testes.
 */
import type { LessonNeighbor, ProgressUpdate } from './course'

export type PipCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export type PipSize = 'small' | 'medium' | 'large'

export const PIP_SEEK_STEPS = [5, 10, 15, 30] as const
export type PipSeekStep = (typeof PIP_SEEK_STEPS)[number]

export const PIP_CORNERS: { id: PipCorner; label: string }[] = [
  { id: 'top-left', label: 'Superior esquerdo' },
  { id: 'top-right', label: 'Superior direito' },
  { id: 'bottom-left', label: 'Inferior esquerdo' },
  { id: 'bottom-right', label: 'Inferior direito' }
]

/** Largura inicial de cada tamanho (a altura segue a proporção 16:9). */
export const PIP_SIZES: { id: PipSize; label: string; width: number }[] = [
  { id: 'small', label: 'Pequena', width: 320 },
  { id: 'medium', label: 'Média', width: 420 },
  { id: 'large', label: 'Grande', width: 560 }
]

export const PIP_ASPECT = 16 / 9
export const PIP_MIN_WIDTH = 240
export const PIP_MAX_WIDTH = 1280
export const PIP_MARGIN = 16
/** Abaixo disso a janela fica difícil de ver; 1 = opaca. */
export const PIP_OPACITY_MIN = 0.2

/** Botões opcionais da janela (tocar/pausar, voltar/avançar, fechar e voltar ao app sempre aparecem). */
export interface PipButtons {
  volume: boolean
  speed: boolean
  subtitles: boolean
  lessons: boolean
  opacity: boolean
}

export interface PipSettings {
  /** Opacidade da janela, de 0,2 a 1. */
  opacity: number
  /** Fica opaca enquanto o mouse está em cima (para enxergar os botões). */
  hoverOpaque: boolean
  /** Segundos dos botões e setas de voltar/avançar. */
  seekStep: PipSeekStep
  size: PipSize
  corner: PipCorner
  /** Reabre onde e do tamanho que estava da última vez. */
  rememberBounds: boolean
  /** Abre sozinha ao sair do player com o vídeo tocando. */
  autoOpen: boolean
  buttons: PipButtons
}

export const DEFAULT_PIP_SETTINGS: PipSettings = {
  opacity: 1,
  hoverOpaque: true,
  seekStep: 10,
  size: 'medium',
  corner: 'bottom-right',
  rememberBounds: true,
  autoOpen: false,
  buttons: { volume: true, speed: true, subtitles: true, lessons: true, opacity: true }
}

export function clampOpacity(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 1
  return Math.round(Math.min(1, Math.max(PIP_OPACITY_MIN, n)) * 100) / 100
}

/** Aceita qualquer coisa vinda do banco ou da interface; o que não servir volta ao padrão. */
export function normalizePipSettings(value: unknown): PipSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const bool = (x: unknown, fallback: boolean) => (typeof x === 'boolean' ? x : fallback)
  const d = DEFAULT_PIP_SETTINGS
  const b = (v.buttons && typeof v.buttons === 'object' ? v.buttons : {}) as Record<string, unknown>
  return {
    opacity: v.opacity === undefined ? d.opacity : clampOpacity(v.opacity),
    hoverOpaque: bool(v.hoverOpaque, d.hoverOpaque),
    seekStep: PIP_SEEK_STEPS.includes(v.seekStep as PipSeekStep) ? (v.seekStep as PipSeekStep) : d.seekStep,
    size: PIP_SIZES.some((s) => s.id === v.size) ? (v.size as PipSize) : d.size,
    corner: PIP_CORNERS.some((c) => c.id === v.corner) ? (v.corner as PipCorner) : d.corner,
    rememberBounds: bool(v.rememberBounds, d.rememberBounds),
    autoOpen: bool(v.autoOpen, d.autoOpen),
    buttons: {
      volume: bool(b.volume, d.buttons.volume),
      speed: bool(b.speed, d.buttons.speed),
      subtitles: bool(b.subtitles, d.buttons.subtitles),
      lessons: bool(b.lessons, d.buttons.lessons),
      opacity: bool(b.opacity, d.buttons.opacity)
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Posição e tamanho

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

const heightFor = (width: number) => Math.round(width / PIP_ASPECT)

/** Janela nova no canto escolhido da área útil da tela (sem a barra de tarefas). */
export function initialPipBounds(work: Rect, size: PipSize, corner: PipCorner): Rect {
  const wanted = PIP_SIZES.find((s) => s.id === size)?.width ?? PIP_SIZES[1].width
  const width = Math.max(PIP_MIN_WIDTH, Math.min(wanted, work.width - 2 * PIP_MARGIN))
  const height = heightFor(width)
  const left = corner.endsWith('left')
  const top = corner.startsWith('top')
  return {
    x: left ? work.x + PIP_MARGIN : work.x + work.width - width - PIP_MARGIN,
    y: top ? work.y + PIP_MARGIN : work.y + work.height - height - PIP_MARGIN,
    width,
    height
  }
}

/**
 * Posição guardada só vale se a janela continuar visível em alguma tela (o monitor pode ter sido desconectado).
 * Devolve a posição ajustada para caber inteira na tela onde está a maior parte dela, ou `null`.
 */
export function restorePipBounds(saved: unknown, screens: Rect[]): Rect | null {
  const s = saved as Partial<Rect> | null
  if (!s || ![s.x, s.y, s.width, s.height].every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const width = Math.round(Math.min(PIP_MAX_WIDTH, Math.max(PIP_MIN_WIDTH, s.width!)))
  const rect = { x: Math.round(s.x!), y: Math.round(s.y!), width, height: heightFor(width) }
  const overlap = (w: Rect) =>
    Math.max(0, Math.min(rect.x + rect.width, w.x + w.width) - Math.max(rect.x, w.x)) *
    Math.max(0, Math.min(rect.y + rect.height, w.y + w.height) - Math.max(rect.y, w.y))
  const best = screens.map((w) => ({ w, area: overlap(w) })).sort((a, b) => b.area - a.area)[0]
  // Menos de um quarto à vista: provavelmente era outro monitor.
  if (!best || best.area < (rect.width * rect.height) / 4) return null
  const w = best.w
  const fitWidth = Math.min(rect.width, w.width)
  const fitted = { ...rect, width: fitWidth, height: heightFor(fitWidth) }
  fitted.x = Math.min(Math.max(fitted.x, w.x), w.x + w.width - fitted.width)
  fitted.y = Math.min(Math.max(fitted.y, w.y), w.y + w.height - fitted.height)
  return fitted
}

export type PipEdge = 'nw' | 'ne' | 'sw' | 'se'

/**
 * Redimensiona arrastando um canto, mantendo 16:9 e o canto oposto parado. `dx`/`dy` são o deslocamento do mouse
 * desde o início do arrasto; vale o eixo que mais cresceu.
 */
export function resizePipBounds(start: Rect, edge: PipEdge, dx: number, dy: number): Rect {
  const sx = edge.endsWith('e') ? 1 : -1
  const sy = edge.startsWith('s') ? 1 : -1
  const byWidth = start.width + sx * dx
  const byHeight = (start.height + sy * dy) * PIP_ASPECT
  const width = Math.round(Math.min(PIP_MAX_WIDTH, Math.max(PIP_MIN_WIDTH, Math.max(byWidth, byHeight))))
  const height = heightFor(width)
  return {
    x: sx === 1 ? start.x : start.x + start.width - width,
    y: sy === 1 ? start.y : start.y + start.height - height,
    width,
    height
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Reprodução

/** Mínimo para valer a pena retomar de onde parou. */
export const RESUME_MIN_SEC = 5
/** Perto do fim, recomeça do início em vez de retomar. */
export const RESUME_END_MARGIN_SEC = 10

/**
 * Onde o vídeo começa: o segundo pedido (link com horário, vindo do player), senão a posição salva se fizer sentido.
 * `null` = do início. Mesma regra no player e na janela flutuante.
 */
export function startPosition(startAt: number | null, saved: number, duration: number): { sec: number; resumed: boolean } | null {
  if (startAt !== null && Number.isFinite(startAt) && startAt >= 0 && startAt < duration) return { sec: startAt, resumed: false }
  if (saved > RESUME_MIN_SEC && saved < duration - RESUME_END_MARGIN_SEC) return { sec: saved, resumed: true }
  return null
}

export interface PipTrack {
  url: string
  /** Nome do arquivo de legenda (vira rótulo pelo idioma, quando houver). */
  name: string
  /** Código do idioma; `null` na transcrição automática e em legendas sem idioma no nome. */
  lang: string | null
}

export interface PipLesson {
  id: number
  title: string
  url: string
  durationSec: number | null
  positionSec: number
  tracks: PipTrack[]
  prev: LessonNeighbor | null
  next: LessonNeighbor | null
}

/** Ajustes do vídeo que passam do player para a janela e voltam. */
export interface PipPlayback {
  rate: number
  volume: number
  muted: boolean
  /** Idioma da legenda escolhida, '' para legenda sem idioma, ou 'off'. */
  subtitle: string
}

export const DEFAULT_PLAYBACK: PipPlayback = { rate: 1, volume: 1, muted: false, subtitle: 'off' }

export const PIP_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

export function normalizePlayback(value: unknown): PipPlayback {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const rate = Number(v.rate)
  const volume = Number(v.volume)
  return {
    rate: PIP_SPEEDS.includes(rate) ? rate : 1,
    volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1,
    muted: v.muted === true,
    subtitle: typeof v.subtitle === 'string' && /^(off|[\w-]{0,20})$/.test(v.subtitle) ? v.subtitle : 'off'
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Mensagens

/** Do processo principal para a janela flutuante. */
export type PipCommand =
  | {
      type: 'config'
      settings: PipSettings
      /** Contagem para a próxima aula quando uma termina (preferência do player). */
      autoplayNext: boolean
      /** Variáveis CSS da cor de destaque. */
      accent: Record<string, string>
      /** `false` quando a janela não consegue se mover sozinha (Wayland): arrasta pela barra do sistema. */
      canMove: boolean
    }
  | { type: 'load'; lesson: PipLesson; startAt: number | null; play: boolean; playback?: PipPlayback }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; time: number; play?: boolean }

/** Da janela flutuante para o processo principal. */
export type PipEvent =
  | { type: 'ready' }
  | { type: 'state'; lessonId: number; time: number; duration: number; paused: boolean; playback: PipPlayback }
  | { type: 'progress'; update: ProgressUpdate }
  | { type: 'ended'; lessonId: number }
  /** Pede outra aula (anterior/próxima): o processo principal confere se é vizinha da atual. */
  | { type: 'go'; lessonId: number }
  | { type: 'return' }
  | { type: 'close' }
  | { type: 'opacity'; value: number }

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const id = (x: unknown) => (Number.isInteger(x) && (x as number) > 0 ? (x as number) : null)

/** Confere o que chega da janela (que mostra arquivos dos cursos): nada malformado passa adiante. */
export function parsePipEvent(raw: unknown): PipEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  switch (e.type) {
    case 'ready':
    case 'return':
    case 'close':
      return { type: e.type }
    case 'state': {
      const lessonId = id(e.lessonId)
      const time = num(e.time)
      if (lessonId === null || time === null) return null
      return {
        type: 'state',
        lessonId,
        time: Math.max(0, time),
        duration: Math.max(0, num(e.duration) ?? 0),
        paused: e.paused !== false,
        playback: normalizePlayback(e.playback)
      }
    }
    case 'progress': {
      const u = (e.update ?? {}) as Record<string, unknown>
      const lessonId = id(u.lessonId)
      const positionSec = num(u.positionSec)
      if (lessonId === null || positionSec === null) return null
      const durationSec = num(u.durationSec)
      return {
        type: 'progress',
        update: {
          lessonId,
          positionSec: Math.max(0, positionSec),
          durationSec: durationSec !== null && durationSec > 0 ? durationSec : null,
          // Mesmo teto do player: um envio nunca soma mais que 10 min.
          watchedSec: Math.min(600, Math.max(0, num(u.watchedSec) ?? 0))
        }
      }
    }
    case 'ended':
    case 'go': {
      const lessonId = id(e.lessonId)
      return lessonId === null ? null : { type: e.type, lessonId }
    }
    case 'opacity':
      return num(e.value) === null ? null : { type: 'opacity', value: clampOpacity(e.value) }
    default:
      return null
  }
}

/** Situação da janela flutuante, enviada às janelas do app. */
export interface PipStatus {
  open: boolean
  lessonId: number | null
  time: number
  duration: number
  paused: boolean
  playback: PipPlayback | null
  /** `false` quando o sistema não deixa a janela ficar por cima das outras sozinha. */
  onTop: boolean
}

export const CLOSED_PIP: PipStatus = { open: false, lessonId: null, time: 0, duration: 0, paused: true, playback: null, onTop: true }

export interface PipOpenRequest {
  lessonId: number
  time: number
  playing: boolean
  playback: PipPlayback
  autoplayNext: boolean
}

/** Do processo principal para as janelas do app. */
export type PipAppEvent =
  | { type: 'status'; status: PipStatus }
  /** "Voltar ao app": o player continua dali. */
  | { type: 'return'; lessonId: number; time: number; playing: boolean; playback: PipPlayback }
  /** Uma aula terminou na janela flutuante e foi marcada como concluída. */
  | { type: 'completed'; lessonId: number }

/** Canais da janela flutuante com o processo dono dela (que pode ser um processo separado, em X11). */
export const PIP_CHANNELS = {
  command: 'pip-window:command',
  event: 'pip-window:event',
  opacity: 'pip-window:opacity',
  move: 'pip-window:move',
  bounds: 'pip-window:bounds',
  getBounds: 'pip-window:getBounds'
} as const

/** Ponte `window.pip` da janela flutuante (preload próprio). */
export interface PipWindowApi {
  emit(event: PipEvent): void
  onCommand(callback: (command: PipCommand) => void): () => void
  setOpacity(value: number): void
  moveTo(x: number, y: number): void
  setBounds(rect: Rect): void
  /** Posição e tamanho do conteúdo (no X11 o `screenX` da página inclui a sombra invisível da janela). */
  getBounds(): Promise<Rect>
}
