import type { LessonView } from '@shared/course'
import { segmentsToVtt } from '@shared/media'
import { accentVars, DEFAULT_APPEARANCE } from '@shared/appearance'
import {
  CLOSED_PIP,
  normalizePlayback,
  parsePipEvent,
  type PipAppEvent,
  type PipCommand,
  type PipLesson,
  type PipOpenRequest,
  type PipPlayback,
  type PipStatus,
  type Rect
} from '@shared/pip'
import type { AppSettings } from '@shared/ipc'
import type { Database } from '../db/database'
import { assetFilePath, getLessonView, lessonFilePath, saveProgress, setCompleted } from '../db/lessons'
import { getTranscript } from '../db/media'
import { getInternal, getSettings, setInternal, updateSettings } from '../db/settings'
import { mediaKey, type PipMediaMap } from './messages'
import type { PipTransport, TransportHandlers, TransportOptions } from './transport'

export interface PipHostDeps {
  db: Database
  convertedDir: string
  /** `fallback`: o processo separado falhou; abre como janela comum do app. */
  createTransport(options: TransportOptions, handlers: TransportHandlers, fallback: boolean): PipTransport
  broadcast(event: PipAppEvent): void
  /** Traz a janela principal do app para a frente. */
  focusApp(): void
}

const BOUNDS_KEY = 'pipBounds'

/** Vizinha só serve se também for vídeo (texto e PDF não abrem na janela flutuante). */
function videoNeighbor(db: Database, neighbor: LessonView['next']): LessonView['next'] {
  if (!neighbor) return null
  const row = db.prepare('SELECT kind FROM lessons WHERE id = ?').get(neighbor.id) as { kind: string } | undefined
  return row?.kind === 'video' ? neighbor : null
}

export function toPipLesson(db: Database, lesson: LessonView): PipLesson {
  return {
    id: lesson.id,
    title: lesson.title,
    url: lesson.url,
    durationSec: lesson.durationSec,
    positionSec: lesson.progress.positionSec,
    tracks: [
      ...lesson.assets.filter((a) => a.kind === 'subtitle').map((a) => ({ url: a.url, name: a.name, lang: a.lang })),
      ...(lesson.transcriptUrl ? [{ url: lesson.transcriptUrl, name: 'Transcrição automática', lang: null }] : [])
    ],
    prev: videoNeighbor(db, lesson.prev),
    next: videoNeighbor(db, lesson.next)
  }
}

/** Arquivos que a janela flutuante pode pedir para esta aula. */
export function pipMediaFor(db: Database, convertedDir: string, lesson: LessonView): PipMediaMap {
  const files: PipMediaMap = {}
  const add = (url: string, media: PipMediaMap[string]) => {
    const key = mediaKey(url)
    if (key) files[key] = media
  }
  add(lesson.url, { path: lessonFilePath(db, lesson.id, convertedDir) })
  for (const asset of lesson.assets) if (asset.kind === 'subtitle') add(asset.url, { path: assetFilePath(db, asset.id) })
  if (lesson.transcriptUrl) {
    const transcript = getTranscript(db, lesson.id)
    if (transcript) add(lesson.transcriptUrl, { body: segmentsToVtt(transcript.segments), type: 'text/vtt; charset=utf-8' })
  }
  return files
}

/**
 * Dono da janela flutuante no processo principal. A janela só toca e mostra; quem grava progresso, marca a aula
 * como concluída e troca de aula é este objeto, para funcionar mesmo com o player fechado no app.
 */
export class PipHost {
  private transport: PipTransport | null = null
  private lesson: LessonView | null = null
  private autoplayNext = true
  private current: PipStatus = CLOSED_PIP

  constructor(private readonly deps: PipHostDeps) {}

  status(): PipStatus {
    return this.current
  }

  open(request: PipOpenRequest): PipStatus {
    const lesson = getLessonView(this.deps.db, request.lessonId)
    if (lesson.kind !== 'video') throw new Error('Só aulas em vídeo abrem na janela flutuante')
    this.autoplayNext = request.autoplayNext
    if (!this.transport) this.start(false)
    this.load(lesson, Math.max(0, request.time), request.playing, normalizePlayback(request.playback))
    return this.current
  }

  close(): void {
    this.shutdown()
  }

  /** Comandos do player do app (ex.: clicar num horário da transcrição com a janela aberta). */
  command(command: PipCommand): void {
    if (!this.transport) return
    if (command.type === 'play' || command.type === 'pause') this.transport.send({ type: command.type })
    else if (command.type === 'seek' && Number.isFinite(command.time)) {
      this.transport.send({ type: 'seek', time: Math.max(0, command.time), play: command.play === true })
    }
  }

  /** As preferências mudaram na tela de configurações: a janela aberta se ajusta na hora. */
  settingsChanged(settings: AppSettings): void {
    if (this.transport) this.transport.send(this.config(settings))
  }

  private config(settings = getSettings(this.deps.db)): PipCommand {
    return {
      type: 'config',
      settings: settings.pip,
      autoplayNext: this.autoplayNext,
      // A janela é sempre escura (vídeo), só a cor de destaque segue a aparência.
      accent: accentVars(settings.appearance?.accent ?? DEFAULT_APPEARANCE.accent, 'dark'),
      canMove: this.transport?.canMove ?? true
    }
  }

  private start(fallback: boolean): void {
    const settings = getSettings(this.deps.db)
    const transport = this.deps.createTransport(
      { settings: settings.pip, savedBounds: getInternal(this.deps.db, BOUNDS_KEY) ?? null },
      {
        onEvent: (raw) => transport === this.transport && this.handle(raw),
        onBounds: (rect) => this.saveBounds(rect),
        onClosed: (failed) => {
          if (transport !== this.transport) return
          if (failed && !fallback && this.lesson) {
            // Sem XWayland (ou o processo não abriu): janela comum do app, que só não fica por cima sozinha.
            const { lesson, current } = this
            this.transport = null
            this.start(true)
            this.load(lesson, current.time, !current.paused, current.playback ?? undefined)
            return
          }
          this.finish()
        }
      },
      fallback
    )
    this.transport = transport
    transport.send(this.config(settings))
  }

  private load(lesson: LessonView, startAt: number | null, play: boolean, playback?: PipPlayback): void {
    if (!this.transport) return
    this.lesson = lesson
    this.transport.allowMedia(pipMediaFor(this.deps.db, this.deps.convertedDir, lesson))
    this.transport.send({ type: 'load', lesson: toPipLesson(this.deps.db, lesson), startAt, play, playback })
    this.setStatus({
      open: true,
      lessonId: lesson.id,
      time: startAt ?? lesson.progress.positionSec,
      duration: lesson.durationSec ?? 0,
      paused: !play,
      playback: playback ?? this.current.playback,
      onTop: this.transport.onTop
    })
  }

  private handle(raw: unknown): void {
    const event = parsePipEvent(raw)
    const lesson = this.lesson
    if (!event || !lesson) return
    const { db } = this.deps
    switch (event.type) {
      case 'state':
        if (event.lessonId !== lesson.id) return
        this.setStatus({ ...this.current, time: event.time, duration: event.duration, paused: event.paused, playback: event.playback })
        return
      case 'progress':
        if (event.update.lessonId === lesson.id) saveProgress(db, event.update)
        return
      case 'ended':
        if (event.lessonId !== lesson.id) return
        if (!getLessonView(db, lesson.id).progress.completed) setCompleted(db, lesson.id, true)
        this.deps.broadcast({ type: 'completed', lessonId: lesson.id })
        return
      case 'go': {
        // Só anda para as vizinhas em vídeo da aula atual: a janela não escolhe qualquer arquivo.
        const target = [videoNeighbor(db, lesson.prev), videoNeighbor(db, lesson.next)].find((n) => n?.id === event.lessonId)
        if (target) this.load(getLessonView(db, target.id), null, true)
        return
      }
      case 'return': {
        const { time, paused, playback } = this.current
        this.shutdown()
        this.deps.focusApp()
        this.deps.broadcast({ type: 'return', lessonId: lesson.id, time, playing: !paused, playback: playback ?? normalizePlayback(null) })
        return
      }
      case 'close':
        this.shutdown()
        return
      case 'opacity': {
        const settings = getSettings(db)
        if (settings.pip.opacity !== event.value) updateSettings(db, { pip: { ...settings.pip, opacity: event.value } })
        return
      }
    }
  }

  private saveBounds(rect: Rect): void {
    setInternal(this.deps.db, BOUNDS_KEY, rect)
  }

  private shutdown(): void {
    const transport = this.transport
    this.finish()
    transport?.close()
  }

  /** Janela fechada: o player do app fica pausado onde a janela parou. */
  private finish(): void {
    if (!this.transport && !this.current.open) return
    this.transport = null
    this.lesson = null
    this.setStatus({ ...this.current, open: false, paused: true })
  }

  private setStatus(status: PipStatus): void {
    this.current = status
    this.deps.broadcast({ type: 'status', status })
  }
}
