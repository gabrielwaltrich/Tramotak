import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Captions,
  Droplet,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import { formatClock } from '@shared/format'
import {
  DEFAULT_PLAYBACK,
  PIP_OPACITY_MIN,
  PIP_SPEEDS,
  clampOpacity,
  resizePipBounds,
  startPosition,
  type PipCommand,
  type PipEdge,
  type PipPlayback,
  type Rect
} from '@shared/pip'
import type { ProgressUpdate } from '@shared/course'
import { useProgressTracker } from '../components/player/useProgressTracker'
import { preferredTrack, subtitleLabel } from '../components/player/subtitles'

type Config = Extract<PipCommand, { type: 'config' }>
type Load = Extract<PipCommand, { type: 'load' }> & { seq: number }

const NEXT_COUNTDOWN_SEC = 3
const HIDE_CONTROLS_MS = 2500
/** Movimento mínimo (px) para um clique virar arrasto da janela. */
const DRAG_THRESHOLD = 4
const STATE_EVERY_SEC = 1

const emit = (event: Parameters<typeof window.pip.emit>[0]) => window.pip.emit(event)
const sendProgress = (update: ProgressUpdate) => emit({ type: 'progress', update })

function IconButton({ label, onClick, children, active = false, className = '', ...rest }: {
  label: string
  onClick: () => void
  children: React.ReactNode
  active?: boolean
  className?: string
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      className={`grid size-8 shrink-0 place-items-center rounded-full hover:bg-white/15 ${active ? 'text-accent' : 'text-white'} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

export function PipApp() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [config, setConfig] = useState<Config | null>(null)
  const [load, setLoad] = useState<Load | null>(null)
  const [playback, setPlayback] = useState<PipPlayback>(DEFAULT_PLAYBACK)
  const [opacity, setOpacity] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [hover, setHover] = useState(false)
  const [idle, setIdle] = useState(false)
  const [menu, setMenu] = useState<'opacity' | 'speed' | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [error, setError] = useState(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const lastState = useRef({ time: -1, at: 0 })
  const lastSubtitle = useRef<string | null>(null)

  const lesson = load?.lesson ?? null
  const settings = config?.settings
  const buttons = settings?.buttons
  const step = settings?.seekStep ?? 10
  const flush = useProgressTracker(videoRef, lesson?.id ?? 0, sendProgress, load?.seq)

  // Comandos do processo principal; avisa que está pronta só depois de começar a ouvir.
  useEffect(() => {
    let seq = 0
    const off = window.pip.onCommand((command) => {
      const video = videoRef.current
      switch (command.type) {
        case 'config':
          setConfig(command)
          setOpacity(command.settings.opacity)
          for (const [name, value] of Object.entries(command.accent)) document.documentElement.style.setProperty(name, value)
          break
        case 'load':
          seq += 1
          setLoad({ ...command, seq })
          if (command.playback) setPlayback(command.playback)
          setCountdown(null)
          setError(false)
          setTime(command.startAt ?? 0)
          setDuration(command.lesson.durationSec ?? 0)
          document.title = command.lesson.title
          break
        case 'play':
          video?.play().catch(() => {})
          break
        case 'pause':
          video?.pause()
          break
        case 'seek':
          if (!video) break
          video.currentTime = command.time
          if (command.play) video.play().catch(() => {})
          break
      }
    })
    emit({ type: 'ready' })
    return off
  }, [])

  // Estado para o app (player sincronizado, horário das anotações): a cada segundo e em toda mudança.
  const sendState = useCallback(
    (force = false) => {
      const video = videoRef.current
      if (!video || !lesson) return
      const now = video.currentTime
      if (!force && Math.abs(now - lastState.current.time) < STATE_EVERY_SEC) return
      lastState.current = { time: now, at: Date.now() }
      emit({
        type: 'state',
        lessonId: lesson.id,
        time: now,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        paused: video.paused,
        playback
      })
    },
    [lesson, playback]
  )

  useEffect(() => sendState(true), [sendState])

  // Opacidade: opaca com o mouse em cima (se a pessoa quiser); enquanto ajusta, mostra o valor escolhido.
  const effectiveOpacity = menu === 'opacity' ? opacity : hover && settings?.hoverOpaque ? 1 : opacity
  useEffect(() => window.pip.setOpacity(effectiveOpacity), [effectiveOpacity])

  // Ajustes do vídeo e legenda escolhida.
  const tracks = useMemo(() => lesson?.tracks ?? [], [lesson])
  const track = preferredTrack(tracks, playback.subtitle)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.playbackRate = playback.rate
    video.volume = playback.volume
    video.muted = playback.muted
    const apply = () => Array.from(video.textTracks).forEach((t, i) => (t.mode = i === track ? 'showing' : 'disabled'))
    apply()
    video.textTracks.addEventListener('addtrack', apply)
    return () => video.textTracks.removeEventListener('addtrack', apply)
  }, [playback, track, load?.seq])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video || error) return
    if (video.paused) video.play().catch(() => {})
    else video.pause()
  }, [error])

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = Math.min(Math.max(0, video.currentTime + delta), video.duration || Infinity)
  }, [])

  const updatePlayback = useCallback((patch: Partial<PipPlayback>) => setPlayback((p) => ({ ...p, ...patch })), [])

  const toggleSubtitles = useCallback(() => {
    if (tracks.length === 0) return
    if (playback.subtitle !== 'off') {
      lastSubtitle.current = playback.subtitle
      updatePlayback({ subtitle: 'off' })
    } else {
      updatePlayback({ subtitle: lastSubtitle.current ?? tracks[0].lang ?? '' })
    }
  }, [tracks, playback.subtitle, updatePlayback])

  const changeOpacity = (value: number) => setOpacity(clampOpacity(value))
  const saveOpacity = (value: number) => emit({ type: 'opacity', value: clampOpacity(value) })

  const leave = (type: 'return' | 'close') => {
    flush()
    sendState(true)
    emit({ type })
  }

  // Controles somem depois de um tempo parado com o vídeo tocando.
  const wake = useCallback(() => {
    setIdle(false)
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setIdle(true), HIDE_CONTROLS_MS)
  }, [])
  useEffect(() => () => clearTimeout(idleTimer.current), [])
  const controlsVisible = !error && (!playing || menu !== null || (hover && !idle))

  // Atalhos de teclado (a janela tem foco depois de um clique).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      switch (e.key) {
        case ' ':
        case 'k':
          togglePlay()
          break
        case 'ArrowLeft':
          seekBy(-step)
          break
        case 'ArrowRight':
          seekBy(step)
          break
        case 'ArrowUp':
          updatePlayback({ volume: Math.min(1, Math.round((playback.volume + 0.1) * 100) / 100), muted: false })
          break
        case 'ArrowDown':
          updatePlayback({ volume: Math.max(0, Math.round((playback.volume - 0.1) * 100) / 100) })
          break
        case 'm':
          updatePlayback({ muted: !playback.muted })
          break
        case 'c':
          toggleSubtitles()
          break
        default:
          return
      }
      e.preventDefault()
      wake()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, seekBy, step, playback, updatePlayback, toggleSubtitles, wake])

  // Contagem para a próxima aula, como no player.
  useEffect(() => {
    if (countdown === null) return
    if (countdown <= 0) {
      if (lesson?.next) emit({ type: 'go', lessonId: lesson.next.id })
      return
    }
    const timer = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000)
    return () => clearTimeout(timer)
  }, [countdown, lesson])

  // Arrastar a janela pelo vídeo (um clique sem arrastar toca/pausa) e redimensionar pelos cantos.
  // `start` chega do processo dono da janela logo depois do clique; até lá o movimento ainda não passou do limite.
  const drag = useRef<{ x: number; y: number; start: Rect | null; edge: PipEdge | null; moved: boolean; toggles: boolean } | null>(null)
  const canMove = config?.canMove ?? true

  /** `toggles`: um clique sem arrastar toca/pausa (só sobre o vídeo, não nas barras). */
  const onPointerDown = (e: React.PointerEvent, edge: PipEdge | null = null, toggles = false) => {
    if (e.button !== 0) return
    setMenu(null)
    if (!canMove && !edge) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const d = { x: e.screenX, y: e.screenY, start: null as Rect | null, edge, moved: false, toggles }
    drag.current = d
    void window.pip.getBounds().then((rect) => (d.start = rect), () => (drag.current = null))
  }
  const onPointerMove = (e: React.PointerEvent) => {
    wake()
    const d = drag.current
    if (!d?.start) return
    const dx = e.screenX - d.x
    const dy = e.screenY - d.y
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    d.moved = true
    if (d.edge) window.pip.setBounds(resizePipBounds(d.start, d.edge, dx, dy))
    else window.pip.moveTo(d.start.x + dx, d.start.y + dy)
  }
  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (d && !d.moved && d.toggles) togglePlay()
  }
  const dragHandlers = { onPointerDown: (e: React.PointerEvent) => onPointerDown(e), onPointerMove, onPointerUp }
  const startResize = (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation()
    onPointerDown(e, e.currentTarget.dataset.edge as PipEdge)
  }

  const onLoadedMetadata = () => {
    const video = videoRef.current
    if (!video || !load) return
    setDuration(video.duration)
    const start = startPosition(load.startAt, load.lesson.positionSec, video.duration)
    if (start) video.currentTime = start.sec
    if (load.play) video.play().catch(() => {})
  }

  const onEnded = () => {
    if (!lesson) return
    sendState(true)
    emit({ type: 'ended', lessonId: lesson.id })
    setMenu(null)
    if (config?.autoplayNext && lesson.next) setCountdown(NEXT_COUNTDOWN_SEC)
  }

  if (!lesson) return <div className="h-full bg-black" />

  const VolumeIcon = playback.muted || playback.volume === 0 ? VolumeX : playback.volume < 0.5 ? Volume1 : Volume2
  const progress = duration > 0 ? (time / duration) * 100 : 0
  const fade = `transition-opacity duration-200 ${controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'}`

  return (
    <div
      className={`relative h-full overflow-hidden bg-black text-white ${controlsVisible ? '' : 'cursor-none'}`}
      // Qualquer movimento dentro da janela conta como "em cima" (um mouseleave perdido não esconde os controles).
      onMouseEnter={() => {
        setHover(true)
        wake()
      }}
      onMouseMove={() => {
        setHover(true)
        wake()
      }}
      onMouseLeave={() => {
        setHover(false)
        setMenu(null)
      }}
    >
      <video
        key={load!.seq}
        ref={videoRef}
        src={lesson.url}
        crossOrigin="anonymous"
        preload="metadata"
        className="absolute inset-0 h-full w-full"
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={(e) => {
          setTime(e.currentTarget.currentTime)
          sendState()
        }}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onPlay={() => {
          setPlaying(true)
          setCountdown(null)
          sendState(true)
        }}
        onPause={() => {
          setPlaying(false)
          sendState(true)
        }}
        onSeeked={() => sendState(true)}
        onEnded={onEnded}
        onError={() => setError(true)}
      >
        {tracks.map((t, i) => (
          <track key={`${load!.seq}:${i}`} kind="subtitles" src={t.url} srcLang={t.lang ?? undefined} label={subtitleLabel(t.lang, t.name)} />
        ))}
      </video>

      {/* Superfície de arrasto/clique sobre o vídeo; no Wayland quem move é a barra do sistema (app-region). */}
      <div
        className="absolute inset-0"
        style={canMove ? undefined : ({ WebkitAppRegion: 'drag' } as React.CSSProperties)}
        onPointerDown={(e) => onPointerDown(e, null, true)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/85 p-4 text-center text-sm">
          <p>Este vídeo não pode ser reproduzido aqui.</p>
          <button type="button" onClick={() => leave('return')} className="rounded-md bg-white/15 px-3 py-1.5 hover:bg-white/25">
            Abrir no Tramotak
          </button>
        </div>
      )}

      {countdown !== null && lesson.next && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/80 p-4 text-center">
          <p className="text-xs text-white/70">Próxima aula em {countdown}…</p>
          <p className="line-clamp-2 text-sm font-medium">{lesson.next.title}</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setCountdown(null)} className="rounded-md bg-white/15 px-3 py-1 text-xs hover:bg-white/25">
              Cancelar
            </button>
            <button type="button" onClick={() => emit({ type: 'go', lessonId: lesson.next!.id })} className="rounded-md bg-accent px-3 py-1 text-xs text-on-accent hover:brightness-110">
              Assistir agora
            </button>
          </div>
        </div>
      )}

      {/* Barra de cima: som, legenda, transparência | título | voltar ao app, fechar */}
      <div {...dragHandlers} className={`absolute inset-x-0 top-0 z-10 flex items-center gap-0.5 bg-gradient-to-b from-black/80 to-transparent px-1.5 pt-1.5 pb-6 ${fade}`}>
        {buttons?.volume !== false && (
          <div className="group flex items-center">
            <IconButton label={playback.muted ? 'Ativar som (M)' : 'Silenciar (M)'} onClick={() => updatePlayback({ muted: !playback.muted })}>
              <VolumeIcon size={17} />
            </IconButton>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={playback.muted ? 0 : playback.volume}
              onChange={(e) => updatePlayback({ volume: Number(e.target.value), muted: Number(e.target.value) === 0 })}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Volume"
              className="h-1 w-0 cursor-pointer accent-white opacity-0 transition-all group-hover:w-16 group-hover:opacity-100"
            />
          </div>
        )}
        {buttons?.subtitles !== false && tracks.length > 0 && (
          <IconButton label={track >= 0 ? 'Desligar legenda (C)' : 'Ligar legenda (C)'} onClick={toggleSubtitles} active={track >= 0}>
            <Captions size={17} />
          </IconButton>
        )}
        {buttons?.opacity !== false && (
          <div className="relative">
            <IconButton
              label={`Transparência (${Math.round(opacity * 100)}%) — role para ajustar`}
              onClick={() => setMenu((m) => (m === 'opacity' ? null : 'opacity'))}
              onWheel={(e) => {
                const next = clampOpacity(opacity + (e.deltaY < 0 ? 0.05 : -0.05))
                changeOpacity(next)
                saveOpacity(next)
              }}
              active={opacity < 1}
              aria-expanded={menu === 'opacity'}
            >
              <Droplet size={17} />
            </IconButton>
            {menu === 'opacity' && (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute top-9 left-0 z-30 flex items-center gap-2 rounded-lg border border-white/10 bg-black/90 px-3 py-2 shadow-xl"
              >
                <input
                  type="range"
                  min={PIP_OPACITY_MIN}
                  max={1}
                  step={0.05}
                  value={opacity}
                  onChange={(e) => changeOpacity(Number(e.target.value))}
                  onPointerUp={(e) => saveOpacity(Number(e.currentTarget.value))}
                  onKeyUp={(e) => saveOpacity(Number(e.currentTarget.value))}
                  aria-label="Opacidade da janela"
                  className="h-1 w-28 cursor-pointer accent-[var(--accent)]"
                />
                <span className="w-9 text-right text-xs tabular-nums">{Math.round(opacity * 100)}%</span>
              </div>
            )}
          </div>
        )}
        <p className="min-w-0 flex-1 truncate px-1.5 text-xs text-white/80" title={lesson.title}>
          {lesson.title}
        </p>
        <IconButton label="Voltar ao Tramotak" onClick={() => leave('return')}>
          <Maximize2 size={16} />
        </IconButton>
        <IconButton label="Fechar" onClick={() => leave('close')}>
          <X size={18} />
        </IconButton>
      </div>

      {/* Centro: aula anterior, voltar, tocar/pausar, avançar, próxima aula */}
      {!error && countdown === null && (
        <div className={`pointer-events-none absolute inset-0 flex items-center justify-center gap-2 ${fade}`}>
          <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-black/45 px-2 py-1 backdrop-blur-sm">
            {buttons?.lessons !== false && lesson.prev && (
              <IconButton label={`Aula anterior: ${lesson.prev.title}`} onClick={() => emit({ type: 'go', lessonId: lesson.prev!.id })}>
                <SkipBack size={16} fill="currentColor" />
              </IconButton>
            )}
            <IconButton label={`Voltar ${step} s (←)`} onClick={() => seekBy(-step)} className="relative size-10">
              <RotateCcw size={22} />
              <span className="absolute text-[9px] font-semibold">{step}</span>
            </IconButton>
            <button
              type="button"
              onClick={togglePlay}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label={playing ? 'Pausar (espaço)' : 'Reproduzir (espaço)'}
              title={playing ? 'Pausar (espaço)' : 'Reproduzir (espaço)'}
              className="grid size-12 place-items-center rounded-full bg-accent/90 text-on-accent shadow-lg hover:bg-accent"
            >
              {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} className="ml-0.5" fill="currentColor" />}
            </button>
            <IconButton label={`Avançar ${step} s (→)`} onClick={() => seekBy(step)} className="relative size-10">
              <RotateCw size={22} />
              <span className="absolute text-[9px] font-semibold">{step}</span>
            </IconButton>
            {buttons?.lessons !== false && lesson.next && (
              <IconButton label={`Próxima aula: ${lesson.next.title}`} onClick={() => emit({ type: 'go', lessonId: lesson.next!.id })}>
                <SkipForward size={16} fill="currentColor" />
              </IconButton>
            )}
          </div>
        </div>
      )}

      {/* Barra de baixo: posição, tempo, velocidade */}
      <div {...dragHandlers} className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 to-transparent px-2.5 pt-6 pb-1.5 ${fade}`}>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={time}
          onChange={(e) => {
            const video = videoRef.current
            if (video) video.currentTime = Number(e.target.value)
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Posição do vídeo"
          className="h-1 w-full cursor-pointer accent-[var(--accent)]"
          style={{ background: `linear-gradient(to right, var(--accent) ${progress}%, rgb(255 255 255 / 0.25) ${progress}%)` }}
        />
        <div className="mt-0.5 flex items-center text-[11px] tabular-nums text-white/85">
          <span>
            {formatClock(time)} / {formatClock(duration)}
          </span>
          {buttons?.speed !== false && (
            <div className="relative ml-auto">
              <button
                type="button"
                onClick={() => setMenu((m) => (m === 'speed' ? null : 'speed'))}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label="Velocidade"
                aria-expanded={menu === 'speed'}
                title="Velocidade"
                className="rounded px-1.5 py-0.5 hover:bg-white/15"
              >
                {playback.rate}×
              </button>
              {menu === 'speed' && (
                <div
                  role="menu"
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute right-0 bottom-7 z-30 grid w-max grid-cols-4 gap-0.5 rounded-lg border border-white/10 bg-black/90 p-1 shadow-xl"
                >
                  {PIP_SPEEDS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="menuitemradio"
                      aria-checked={s === playback.rate}
                      onClick={() => {
                        updatePlayback({ rate: s })
                        setMenu(null)
                      }}
                      className={`rounded px-1.5 py-1 text-xs ${s === playback.rate ? 'bg-accent text-on-accent' : 'hover:bg-white/15'}`}
                    >
                      {s}×
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Linha de progresso discreta quando os controles somem */}
      {!controlsVisible && !error && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-white/20">
          <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
        </div>
      )}

      {/* Cantos para redimensionar (mantém 16:9) */}
      {canMove &&
        (['nw', 'ne', 'sw', 'se'] as PipEdge[]).map((edge) => (
          <div
            key={edge}
            aria-hidden
            data-edge={edge}
            onPointerDown={startResize}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className={`absolute z-40 size-3.5 ${edge.startsWith('n') ? 'top-0' : 'bottom-0'} ${edge.endsWith('w') ? 'left-0' : 'right-0'} ${
              edge === 'nw' || edge === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize'
            }`}
          />
        ))}
    </div>
  )
}
