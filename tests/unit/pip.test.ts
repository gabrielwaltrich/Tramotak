import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_PIP_SETTINGS,
  initialPipBounds,
  normalizePipSettings,
  normalizePlayback,
  parsePipEvent,
  resizePipBounds,
  restorePipBounds,
  startPosition,
  type PipAppEvent,
  type PipCommand
} from '@shared/pip'
import { openDatabase, type Database } from '../../src/main/db/database'
import { insertScannedCourse } from '../../src/main/db/courses'
import { getLessonView } from '../../src/main/db/lessons'
import { saveTranscript } from '../../src/main/db/media'
import { getInternal, getSettings, updateSettings } from '../../src/main/db/settings'
import { scanCourse } from '../../src/main/scanner/scan'
import { PipHost, pipMediaFor } from '../../src/main/pip/host'
import { choosePipMode } from '../../src/main/pip/mode'
import type { PipTransport, TransportHandlers, TransportOptions } from '../../src/main/pip/transport'
import { mediaUrl } from '@shared/media'
import { makeCourse } from '../helpers/fixture'

const SCREEN = { x: 0, y: 0, width: 1920, height: 1040 }

describe('preferências', () => {
  it('normaliza o que vier, com padrão para o que não servir', () => {
    expect(normalizePipSettings(undefined)).toEqual(DEFAULT_PIP_SETTINGS)
    expect(normalizePipSettings({ opacity: 0.05, seekStep: 7, size: 'huge', corner: 'top-left', buttons: { speed: false } })).toEqual({
      ...DEFAULT_PIP_SETTINGS,
      opacity: 0.2,
      corner: 'top-left',
      buttons: { ...DEFAULT_PIP_SETTINGS.buttons, speed: false }
    })
    expect(normalizePipSettings({ opacity: '0.567', autoOpen: 'sim' })).toMatchObject({ opacity: 0.57, autoOpen: false })
  })

  it('ficam no banco pelas configurações do app', () => {
    const db = openDatabase(':memory:')
    expect(getSettings(db).pip).toEqual(DEFAULT_PIP_SETTINGS)
    updateSettings(db, { pip: { ...DEFAULT_PIP_SETTINGS, opacity: 0.6, seekStep: 30 } })
    expect(getSettings(db).pip).toMatchObject({ opacity: 0.6, seekStep: 30 })
    db.close()
  })

  it('ajustes do vídeo: velocidade fora da lista, volume fora da faixa e legenda estranha voltam ao padrão', () => {
    expect(normalizePlayback({ rate: 3, volume: 4, muted: 'x', subtitle: '../x' })).toEqual({ rate: 1, volume: 1, muted: false, subtitle: 'off' })
    expect(normalizePlayback({ rate: 1.5, volume: 0.3, muted: true, subtitle: 'pt-BR' })).toEqual({ rate: 1.5, volume: 0.3, muted: true, subtitle: 'pt-BR' })
  })
})

describe('posição e tamanho', () => {
  it('abre no canto escolhido, com margem, em 16:9', () => {
    expect(initialPipBounds(SCREEN, 'medium', 'bottom-right')).toEqual({ x: 1920 - 420 - 16, y: 1040 - 236 - 16, width: 420, height: 236 })
    expect(initialPipBounds({ x: 1920, y: 0, width: 1366, height: 728 }, 'small', 'top-left')).toEqual({ x: 1936, y: 16, width: 320, height: 180 })
    // Tela minúscula: não passa da largura útil, mas respeita o mínimo.
    expect(initialPipBounds({ x: 0, y: 0, width: 200, height: 200 }, 'large', 'top-left').width).toBe(240)
  })

  it('lembra a posição só se continuar visível; ajusta para caber', () => {
    expect(restorePipBounds({ x: 100, y: 100, width: 400, height: 225 }, [SCREEN])).toEqual({ x: 100, y: 100, width: 400, height: 225 })
    expect(restorePipBounds({ x: 1700, y: 900, width: 400, height: 225 }, [SCREEN])).toEqual({ x: 1520, y: 815, width: 400, height: 225 })
    // Menos de um quarto à vista: provavelmente outro monitor
    expect(restorePipBounds({ x: 1800, y: 900, width: 400, height: 225 }, [SCREEN])).toBeNull()
    // Monitor que não existe mais
    expect(restorePipBounds({ x: 5000, y: 100, width: 400, height: 225 }, [SCREEN])).toBeNull()
    expect(restorePipBounds({ x: 'a' }, [SCREEN])).toBeNull()
    expect(restorePipBounds(null, [SCREEN])).toBeNull()
  })

  it('redimensiona pelo canto mantendo 16:9 e o canto oposto parado', () => {
    const start = { x: 100, y: 100, width: 400, height: 225 }
    expect(resizePipBounds(start, 'se', 160, 0)).toEqual({ x: 100, y: 100, width: 560, height: 315 })
    // Puxando o canto de cima à esquerda para fora: cresce para cima/esquerda
    expect(resizePipBounds(start, 'nw', -160, 0)).toEqual({ x: -60, y: 10, width: 560, height: 315 })
    // Vale o eixo que mais cresceu
    expect(resizePipBounds(start, 'se', 10, 90).width).toBe(560)
    // Limites
    expect(resizePipBounds(start, 'se', -1000, -1000).width).toBe(240)
    expect(resizePipBounds(start, 'se', 5000, 0).width).toBe(1280)
  })
})

describe('onde o vídeo começa', () => {
  it('horário pedido, senão a posição salva se fizer sentido', () => {
    expect(startPosition(42, 100, 600)).toEqual({ sec: 42, resumed: false })
    expect(startPosition(1, 100, 600)).toEqual({ sec: 1, resumed: false })
    expect(startPosition(null, 100, 600)).toEqual({ sec: 100, resumed: true })
    expect(startPosition(null, 3, 600)).toBeNull() // pouco assistido
    expect(startPosition(null, 595, 600)).toBeNull() // quase no fim: recomeça
    expect(startPosition(700, 100, 600)).toEqual({ sec: 100, resumed: true }) // horário além do fim
  })
})

describe('mensagens da janela', () => {
  it('aceita só o formato esperado', () => {
    expect(parsePipEvent({ type: 'close', extra: 1 })).toEqual({ type: 'close' })
    expect(parsePipEvent({ type: 'state', lessonId: 3, time: 12.5, duration: 60, paused: false, playback: { rate: 2 } })).toEqual({
      type: 'state',
      lessonId: 3,
      time: 12.5,
      duration: 60,
      paused: false,
      playback: { rate: 2, volume: 1, muted: false, subtitle: 'off' }
    })
    expect(parsePipEvent({ type: 'progress', update: { lessonId: 3, positionSec: 10, durationSec: 0, watchedSec: 99999 } })).toEqual({
      type: 'progress',
      update: { lessonId: 3, positionSec: 10, durationSec: null, watchedSec: 600 }
    })
    expect(parsePipEvent({ type: 'opacity', value: 0 })).toEqual({ type: 'opacity', value: 0.2 })
    for (const bad of [null, 'close', { type: 'eval' }, { type: 'go', lessonId: -1 }, { type: 'state', lessonId: 1 }, { type: 'progress' }]) {
      expect(parsePipEvent(bad)).toBeNull()
    }
  })
})

describe('escolha do modo', () => {
  const wayland = { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }
  it('Wayland com XWayland → processo separado em X11', () => {
    expect(choosePipMode('linux', wayland, '')).toEqual({ mode: 'process', onTop: true })
  })
  it('Wayland sem XWayland → janela comum, que não fica por cima sozinha', () => {
    expect(choosePipMode('linux', { ...wayland, DISPLAY: undefined }, '')).toEqual({ mode: 'window', onTop: false })
  })
  it('X11, app aberto em X11 e Windows → janela comum', () => {
    expect(choosePipMode('linux', { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }, '')).toEqual({ mode: 'window', onTop: true })
    expect(choosePipMode('linux', wayland, 'x11')).toEqual({ mode: 'window', onTop: true })
    expect(choosePipMode('win32', {}, '')).toEqual({ mode: 'window', onTop: true })
  })
  it('variável de ambiente força o modo (testes)', () => {
    expect(choosePipMode('win32', { TRAMOTAK_PIP_MODE: 'process' }, '').mode).toBe('process')
    expect(choosePipMode('linux', { ...wayland, TRAMOTAK_PIP_MODE: 'window' }, '').mode).toBe('window')
  })
})

describe('PipHost', () => {
  let db: Database
  let root: string
  let cleanup: (() => Promise<void>) | undefined
  let transports: FakeTransport[]
  let events: PipAppEvent[]
  let focused: number

  class FakeTransport implements PipTransport {
    sent: PipCommand[] = []
    media: Record<string, unknown>[] = []
    closed = false
    constructor(
      readonly options: TransportOptions,
      readonly handlers: TransportHandlers,
      readonly fallback: boolean
    ) {}
    readonly onTop = true
    readonly canMove = true
    send(command: PipCommand) {
      this.sent.push(command)
    }
    allowMedia(files: Record<string, unknown>) {
      this.media.push(files)
    }
    close() {
      this.closed = true
    }
    emit(raw: unknown) {
      this.handlers.onEvent(raw)
    }
    last<T extends PipCommand['type']>(type: T) {
      return this.sent.filter((c) => c.type === type).at(-1) as Extract<PipCommand, { type: T }> | undefined
    }
  }

  const newHost = () =>
    new PipHost({
      db,
      convertedDir: join(root, '.converted'),
      createTransport: (options, handlers, fallback) => {
        const t = new FakeTransport(options, handlers, fallback)
        transports.push(t)
        return t
      },
      broadcast: (event) => events.push(event),
      focusApp: () => (focused += 1)
    })
  const id = (title: string) => (db.prepare('SELECT id FROM lessons WHERE title = ?').get(title) as { id: number }).id
  const playback = { rate: 1.5, volume: 0.8, muted: false, subtitle: 'pt' }
  const open = (host: PipHost, title = 'Primeira', time = 12) =>
    host.open({ lessonId: id(title), time, playing: true, playback, autoplayNext: true })

  beforeEach(async () => {
    db = openDatabase(':memory:')
    const course = await makeCourse(['0. Intro.md', '1. Mod/1. Primeira.mp4', '1. Mod/1. Primeira.pt.srt', '1. Mod/2. Segunda.mp4', '1. Mod/3. Terceira.mp4'])
    root = course.root
    cleanup = course.cleanup
    insertScannedCourse(db, { title: 'Curso', rootPath: root, numbering: 'dot', scanStructure: 'auto' }, await scanCourse(root, { structure: 'auto', numbering: 'dot' }))
    transports = []
    events = []
    focused = 0
  })
  afterEach(async () => {
    db.close()
    await cleanup?.()
  })

  it('abre: configuração, arquivos liberados e a aula no horário do player', () => {
    const host = newHost()
    const status = open(host)
    expect(status).toMatchObject({ open: true, lessonId: id('Primeira'), time: 12, paused: false, playback, onTop: true })
    const t = transports[0]
    expect(t.sent.map((c) => c.type)).toEqual(['config', 'load'])
    expect(t.last('config')).toMatchObject({ settings: DEFAULT_PIP_SETTINGS, autoplayNext: true, canMove: true })
    expect(t.last('load')).toMatchObject({
      startAt: 12,
      play: true,
      playback,
      lesson: { title: 'Primeira', prev: null, next: { title: 'Segunda' }, tracks: [{ name: '1. Primeira.pt.srt', lang: 'pt' }] }
    })
    // Só a aula e a legenda dela
    expect(Object.keys(t.media[0]).sort()).toEqual([`asset/${getLessonView(db, id('Primeira')).assets[0].id}`, `lesson/${id('Primeira')}`])
    expect(events.at(-1)).toMatchObject({ type: 'status', status: { open: true } })
  })

  it('só aulas em vídeo', () => {
    expect(() => newHost().open({ lessonId: id('Intro'), time: 0, playing: false, playback, autoplayNext: true })).toThrow('Só aulas em vídeo')
  })

  it('grava o progresso da aula aberta (e ignora o de outras)', () => {
    const host = newHost()
    open(host)
    transports[0].emit({ type: 'progress', update: { lessonId: id('Primeira'), positionSec: 40, durationSec: 300, watchedSec: 25 } })
    transports[0].emit({ type: 'progress', update: { lessonId: id('Segunda'), positionSec: 99, durationSec: 300, watchedSec: 25 } })
    expect(getLessonView(db, id('Primeira')).progress.positionSec).toBe(40)
    expect(getLessonView(db, id('Segunda')).progress.positionSec).toBe(0)
    expect((db.prepare('SELECT SUM(seconds) AS s FROM study_sessions').get() as { s: number }).s).toBe(25)
  })

  it('estado da janela vai para o app', () => {
    const host = newHost()
    open(host)
    transports[0].emit({ type: 'state', lessonId: id('Primeira'), time: 50, duration: 300, paused: true, playback: { ...playback, rate: 2 } })
    expect(host.status()).toMatchObject({ time: 50, duration: 300, paused: true, playback: { rate: 2 } })
    // Estado atrasado de outra aula não conta
    transports[0].emit({ type: 'state', lessonId: id('Segunda'), time: 1, duration: 300, paused: false, playback })
    expect(host.status().time).toBe(50)
  })

  it('aula terminou: concluída e o app avisado', () => {
    const host = newHost()
    open(host)
    transports[0].emit({ type: 'ended', lessonId: id('Primeira') })
    expect(getLessonView(db, id('Primeira')).progress.completed).toBe(true)
    expect(events).toContainEqual({ type: 'completed', lessonId: id('Primeira') })
  })

  it('anda só para as vizinhas em vídeo da aula atual', () => {
    const host = newHost()
    open(host)
    transports[0].emit({ type: 'go', lessonId: id('Intro') }) // anterior, mas é texto
    expect(host.status().lessonId).toBe(id('Primeira'))
    transports[0].emit({ type: 'go', lessonId: id('Terceira') })
    expect(host.status().lessonId).toBe(id('Primeira'))
    transports[0].emit({ type: 'go', lessonId: id('Segunda') })
    expect(host.status()).toMatchObject({ lessonId: id('Segunda'), paused: false })
    expect(transports[0].last('load')).toMatchObject({ lesson: { title: 'Segunda', prev: { title: 'Primeira' } }, startAt: null, play: true })
    expect(Object.keys(transports[0].media.at(-1)!)).toEqual([`lesson/${id('Segunda')}`])
  })

  it('"voltar ao app": fecha, traz o app para a frente e passa horário e ajustes', () => {
    const host = newHost()
    open(host)
    transports[0].emit({ type: 'state', lessonId: id('Primeira'), time: 77, duration: 300, paused: false, playback })
    transports[0].emit({ type: 'return' })
    expect(transports[0].closed).toBe(true)
    expect(focused).toBe(1)
    expect(events.at(-1)).toEqual({ type: 'return', lessonId: id('Primeira'), time: 77, playing: true, playback })
    expect(host.status()).toMatchObject({ open: false, lessonId: id('Primeira'), time: 77, paused: true })
    // Mensagem atrasada da janela fechada não faz nada
    transports[0].emit({ type: 'ended', lessonId: id('Primeira') })
    expect(getLessonView(db, id('Primeira')).progress.completed).toBe(false)
  })

  it('fechar pelo X ou pelo sistema deixa o app pausado no ponto', () => {
    const host = newHost()
    open(host)
    transports[0].emit({ type: 'state', lessonId: id('Primeira'), time: 30, duration: 300, paused: false, playback })
    transports[0].handlers.onClosed(false)
    expect(host.status()).toMatchObject({ open: false, time: 30, paused: true })
    // Abrir de novo cria outra janela
    open(host, 'Segunda', 0)
    expect(transports).toHaveLength(2)
  })

  it('processo separado que não abriu: tenta como janela comum, na mesma aula e horário', () => {
    const host = newHost()
    open(host)
    transports[0].handlers.onClosed(true)
    expect(transports).toHaveLength(2)
    expect(transports[1].fallback).toBe(true)
    expect(transports[1].last('load')).toMatchObject({ lesson: { title: 'Primeira' }, startAt: 12, play: true })
    expect(host.status().open).toBe(true)
  })

  it('opacidade escolhida na janela vira a preferência; posição é lembrada', () => {
    const host = newHost()
    open(host)
    transports[0].emit({ type: 'opacity', value: 0.45 })
    expect(getSettings(db).pip.opacity).toBe(0.45)
    transports[0].handlers.onBounds({ x: 10, y: 20, width: 500, height: 281 })
    expect(getInternal(db, 'pipBounds')).toEqual({ x: 10, y: 20, width: 500, height: 281 })
    host.close()
    open(host)
    expect(transports[1].options).toMatchObject({ settings: { opacity: 0.45 }, savedBounds: { x: 10, y: 20, width: 500, height: 281 } })
  })

  it('preferências mudadas com a janela aberta chegam na hora', () => {
    const host = newHost()
    open(host)
    host.settingsChanged(updateSettings(db, { pip: { ...DEFAULT_PIP_SETTINGS, seekStep: 30 } }))
    expect(transports[0].last('config')?.settings.seekStep).toBe(30)
  })

  it('comandos do player do app', () => {
    const host = newHost()
    host.command({ type: 'play' }) // fechada: nada
    open(host)
    host.command({ type: 'seek', time: -5, play: true })
    host.command({ type: 'pause' })
    host.command({ type: 'seek', time: Number.NaN })
    expect(transports[0].sent.slice(2)).toEqual([{ type: 'seek', time: 0, play: true }, { type: 'pause' }])
  })

  it('a transcrição vai pronta (WebVTT) para o processo separado', () => {
    saveTranscript(db, id('Segunda'), { provider: 'builtin', model: 'small', language: 'pt', segments: [{ start: 1, end: 2, text: 'Olá' }] })
    const lesson = getLessonView(db, id('Segunda'))
    const files = pipMediaFor(db, join(root, '.converted'), lesson)
    expect(lesson.transcriptUrl).toBe(mediaUrl.transcript(lesson.id, (db.prepare('SELECT created_at AS c FROM transcripts').get() as { c: number }).c))
    expect(files[`transcript/${lesson.id}`]).toMatchObject({ type: 'text/vtt; charset=utf-8' })
    expect((files[`transcript/${lesson.id}`] as { body: string }).body).toContain('Olá')
    expect((files[`lesson/${lesson.id}`] as { path: string }).path).toBe(join(root, '1. Mod', '2. Segunda.mp4'))
  })
})
