import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  Captions,
  Check,
  ExternalLink,
  Maximize,
  Minimize,
  Pause,
  Play,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX
} from 'lucide-react'
import type { LessonView } from '@shared/course'
import { formatClock } from '@shared/format'
import { playerPrefs, SPEEDS } from './prefs'
import { useProgressTracker } from './useProgressTracker'

const HIDE_CONTROLS_MS = 2500
const SEEK_STEP = 10
const RESUME_MIN_SEC = 5

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

function subtitleLabel(lang: string | null, name: string): string {
  if (!lang) return name.replace(/\.(srt|vtt)$/i, '')
  try {
    const display = new Intl.DisplayNames(['pt-BR'], { type: 'language' }).of(lang)
    return display ? display.charAt(0).toUpperCase() + display.slice(1) : lang
  } catch {
    return lang
  }
}

/** Menu suspenso que abre para cima, dentro da barra de controles. */
function PopMenu<T extends string | number>({ label, icon, value, options, onChange }: {
  label: string
  icon: React.ReactNode
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 min-w-8 items-center justify-center rounded px-1.5 text-sm text-white/90 hover:bg-white/15"
      >
        {icon}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 bottom-10 z-10 min-w-36 rounded-lg border border-white/10 bg-black/90 p-1 shadow-xl">
          {options.map((o) => (
            <button
              key={String(o.value)}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm text-white/90 hover:bg-white/10"
            >
              <Check size={14} className={o.value === value ? 'opacity-100' : 'opacity-0'} />
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function VideoPlayer({ lesson, videoRef, startAt = null, onEnded, onNext }: {
  lesson: LessonView
  videoRef: RefObject<HTMLVideoElement | null>
  /** Segundo inicial pedido explicitamente (tem prioridade sobre a posição salva). */
  startAt?: number | null
  onEnded: () => void
  onNext?: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(lesson.durationSec ?? 0)
  const [rate, setRate] = useState(playerPrefs.rate)
  const [volume, setVolume] = useState(playerPrefs.volume)
  const [muted, setMuted] = useState(playerPrefs.muted)
  const [fullscreen, setFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [error, setError] = useState(false)
  const [jump, setJump] = useState<{ sec: number; label: string } | null>(null)

  // Fica aqui (e não na página) porque precisa do <video> já montado.
  useProgressTracker(videoRef, lesson.id)

  const subtitles = lesson.assets.filter((a) => a.kind === 'subtitle')
  const preferred = playerPrefs.subtitle()
  const initialTrack =
    preferred === 'off' ? -1 : Math.max(subtitles.findIndex((s) => (s.lang ?? '') === preferred), subtitles.length ? 0 : -1)
  const [track, setTrack] = useState(initialTrack)

  // Aplica a legenda escolhida nas text tracks do elemento de vídeo.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const apply = () => {
      Array.from(video.textTracks).forEach((t, i) => (t.mode = i === track ? 'showing' : 'disabled'))
    }
    apply()
    video.textTracks.addEventListener('addtrack', apply)
    return () => video.textTracks.removeEventListener('addtrack', apply)
  }, [track, videoRef, lesson.id])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.playbackRate = rate
    video.volume = volume
    video.muted = muted
  }, [rate, volume, muted, videoRef, lesson.id])

  const showControls = useCallback(() => {
    setControlsVisible(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      if (!videoRef.current?.paused) setControlsVisible(false)
    }, HIDE_CONTROLS_MS)
  }, [videoRef])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video || error) return
    if (video.paused) video.play().catch(() => {})
    else video.pause()
  }, [videoRef, error])

  const seekBy = useCallback(
    (delta: number) => {
      const video = videoRef.current
      if (!video) return
      video.currentTime = Math.min(Math.max(0, video.currentTime + delta), video.duration || Infinity)
      showControls()
    },
    [videoRef, showControls]
  )

  const changeRate = useCallback((next: number) => {
    setRate(next)
    playerPrefs.setRate(next)
  }, [])

  // Passos relativos usam atualização funcional: teclas repetidas rápido não leem valor velho.
  const stepRate = useCallback((direction: 1 | -1) => {
    setRate((current) => {
      const index = SPEEDS.indexOf(current)
      const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, (index < 0 ? SPEEDS.indexOf(1) : index) + direction))]
      playerPrefs.setRate(next)
      return next
    })
  }, [])

  const changeVolume = useCallback((next: number | ((current: number) => number)) => {
    setVolume((current) => {
      const v = Math.round(Math.min(1, Math.max(0, typeof next === 'function' ? next(current) : next)) * 100) / 100
      setMuted(v === 0)
      playerPrefs.setVolume(v)
      playerPrefs.setMuted(v === 0)
      return v
    })
  }, [])

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      playerPrefs.setMuted(!m)
      return !m
    })
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen()
    else containerRef.current?.requestFullscreen()
  }, [])

  const chooseTrack = (index: number) => {
    setTrack(index)
    playerPrefs.setSubtitle(index < 0 ? 'off' : (subtitles[index].lang ?? ''))
  }

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Atalhos de teclado do player.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      switch (e.key) {
        case ' ':
        case 'k':
          togglePlay()
          break
        case 'ArrowLeft':
          seekBy(-SEEK_STEP)
          break
        case 'ArrowRight':
          seekBy(SEEK_STEP)
          break
        case 'ArrowUp':
          changeVolume((v) => v + 0.1)
          break
        case 'ArrowDown':
          changeVolume((v) => v - 0.1)
          break
        case 'm':
          toggleMute()
          break
        case 'f':
          toggleFullscreen()
          break
        case '[':
          stepRate(-1)
          break
        case ']':
          stepRate(1)
          break
        case 'N':
          if (e.shiftKey && onNext) onNext()
          else return
          break
        default:
          return
      }
      e.preventDefault()
      showControls()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePlay, seekBy, changeVolume, toggleMute, toggleFullscreen, stepRate, onNext, showControls])

  useEffect(() => () => clearTimeout(hideTimer.current), [])

  const onLoadedMetadata = () => {
    const video = videoRef.current!
    setDuration(video.duration)
    if (Number.isFinite(video.duration) && video.duration > 0 && lesson.durationSec === null) {
      window.api.lessons.setDuration(lesson.id, video.duration).catch(() => {})
    }
    const saved = lesson.progress.positionSec
    if (startAt !== null && startAt < video.duration) {
      video.currentTime = startAt
      setJump({ sec: startAt, label: 'Indo para' })
      setTimeout(() => setJump(null), 3000)
    } else if (saved > RESUME_MIN_SEC && saved < video.duration - SEEK_STEP) {
      video.currentTime = saved
      setJump({ sec: saved, label: 'Retomando de' })
      setTimeout(() => setJump(null), 3000)
    }
    video.play().catch(() => {})
  }

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  const progress = duration > 0 ? (time / duration) * 100 : 0

  return (
    <div
      ref={containerRef}
      onMouseMove={showControls}
      onMouseLeave={() => !videoRef.current?.paused && setControlsVisible(false)}
      className={`group relative aspect-video w-full overflow-hidden bg-black ${fullscreen ? '' : 'rounded-xl'} ${
        controlsVisible || !playing ? '' : 'cursor-none'
      }`}
    >
      <video
        key={lesson.id}
        ref={videoRef}
        src={lesson.url}
        crossOrigin="anonymous"
        preload="metadata"
        className="h-full w-full"
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onPlay={() => {
          setPlaying(true)
          showControls()
        }}
        onPause={() => {
          setPlaying(false)
          setControlsVisible(true)
        }}
        onEnded={onEnded}
        onError={() => setError(true)}
      >
        {subtitles.map((s) => (
          <track key={s.id} kind="subtitles" src={s.url} srcLang={s.lang ?? undefined} label={subtitleLabel(s.lang, s.name)} />
        ))}
      </video>

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 p-6 text-center text-white">
          <p className="font-medium">Este vídeo não pode ser reproduzido aqui</p>
          <p className="max-w-sm text-sm text-white/70">
            O formato ou o codec não é suportado pelo player interno. Você pode abri-lo no player do sistema.
          </p>
          <button
            type="button"
            onClick={() => window.api.files.openLesson(lesson.id)}
            className="mt-1 inline-flex items-center gap-2 rounded-md bg-white/15 px-4 py-2 text-sm hover:bg-white/25"
          >
            <ExternalLink size={16} /> Abrir no player do sistema
          </button>
        </div>
      )}

      {jump !== null && (
        <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-black/75 px-3 py-1 text-sm text-white">
          {jump.label} {formatClock(jump.sec)}
        </div>
      )}

      {!playing && !error && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label="Reproduzir"
          className="absolute top-1/2 left-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-accent/90 text-white shadow-lg hover:bg-accent"
        >
          <Play size={28} className="ml-1" fill="currentColor" />
        </button>
      )}

      {!error && (
        <div
          className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-4 pt-10 pb-3 transition-opacity ${
            controlsVisible || !playing ? 'opacity-100' : 'opacity-0'
          }`}
        >
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
            aria-label="Posição do vídeo"
            className="mb-2 h-1 w-full cursor-pointer accent-[var(--accent)]"
            style={{ background: `linear-gradient(to right, var(--accent) ${progress}%, rgb(255 255 255 / 0.25) ${progress}%)` }}
          />
          <div className="flex items-center gap-1 text-white">
            <button type="button" onClick={togglePlay} aria-label={playing ? 'Pausar' : 'Reproduzir'} className="grid size-8 place-items-center rounded hover:bg-white/15">
              {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
            </button>
            {onNext && (
              <button type="button" onClick={onNext} aria-label="Próxima aula" title="Próxima aula (Shift+N)" className="grid size-8 place-items-center rounded hover:bg-white/15">
                <SkipForward size={18} />
              </button>
            )}
            <button type="button" onClick={toggleMute} aria-label={muted ? 'Ativar som' : 'Silenciar'} className="grid size-8 place-items-center rounded hover:bg-white/15">
              <VolumeIcon size={18} />
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => changeVolume(Number(e.target.value))}
              aria-label="Volume"
              className="h-1 w-20 cursor-pointer accent-white"
            />
            <span className="ml-2 text-xs tabular-nums text-white/80">
              {formatClock(time)} / {formatClock(duration)}
            </span>

            <div className="ml-auto flex items-center gap-1">
              <PopMenu
                label="Velocidade"
                icon={<span className="tabular-nums">{rate}×</span>}
                value={rate}
                options={SPEEDS.map((s) => ({ value: s, label: s === 1 ? 'Normal' : `${s}×` }))}
                onChange={changeRate}
              />
              {subtitles.length > 0 && (
                <PopMenu
                  label="Legendas"
                  icon={<Captions size={18} className={track >= 0 ? 'text-accent' : ''} />}
                  value={track}
                  options={[{ value: -1, label: 'Desligadas' }, ...subtitles.map((s, i) => ({ value: i, label: subtitleLabel(s.lang, s.name) }))]}
                  onChange={chooseTrack}
                />
              )}
              <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} className="grid size-8 place-items-center rounded hover:bg-white/15">
                {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
