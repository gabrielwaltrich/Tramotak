import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Captions,
  Check,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX
} from 'lucide-react'
import type { LessonView } from '@shared/course'
import { formatClock } from '@shared/format'
import { startPosition, type PipOpenRequest, type PipPlayback } from '@shared/pip'
import { errorMessage, queryKeys } from '../../lib/api'
import { onPipEvent, pipStatus, setPipReturnTarget, usePipStatus } from '../../lib/pip'
import { useToast } from '../Toast'
import { playerPrefs, SPEEDS } from './prefs'
import { useProgressTracker } from './useProgressTracker'
import { ConvertOffer } from './ConvertOffer'
import { preferredTrack, subtitleLabel } from './subtitles'

const HIDE_CONTROLS_MS = 2500
const SEEK_STEP = 10

/** Horário para acompanhar a janela flutuante sem chegar ao fim do vídeo daqui (que dispararia "terminou"). */
const syncTarget = (time: number, duration: number) => (Number.isFinite(duration) && duration > 1 ? Math.min(time, duration - 0.5) : time)

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
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

export function VideoPlayer({ lesson, videoRef, startAt = null, onEnded, onNext, onPipFollow }: {
  lesson: LessonView
  videoRef: RefObject<HTMLVideoElement | null>
  /** Segundo inicial pedido explicitamente (tem prioridade sobre a posição salva). */
  startAt?: number | null
  onEnded: () => void
  onNext?: () => void
  /** A janela flutuante passou para outra aula (próxima/anterior): o app acompanha. */
  onPipFollow?: (lessonId: number) => void
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
  const [mediaError, setMediaError] = useState(false)
  // O Chromium não acusa erro em vídeo HEVC: toca só o áudio, com imagem 0×0. Por isso o formato
  // é conferido com o FFmpeg ao abrir (rápido) — a cópia convertida já é compatível por construção.
  const format = useQuery({
    queryKey: ['probe', lesson.id],
    queryFn: () => window.api.media.probe(lesson.id),
    enabled: !lesson.converted,
    retry: false,
    staleTime: 0
  })
  const unsupported = !lesson.converted && format.data !== undefined && !format.data.playable
  const error = mediaError || unsupported
  const setError = setMediaError

  useEffect(() => {
    if (unsupported) videoRef.current?.pause()
  }, [unsupported, videoRef])
  const [jump, setJump] = useState<{ sec: number; label: string } | null>(null)

  // Fica aqui (e não na página) porque precisa do <video> já montado.
  useProgressTracker(videoRef, lesson.id)

  const subtitles = [
    ...lesson.assets.filter((a) => a.kind === 'subtitle'),
    ...(lesson.transcriptUrl ? [{ id: -1, kind: 'subtitle' as const, name: 'Transcrição automática', lang: null, url: lesson.transcriptUrl }] : [])
  ]
  const [track, setTrack] = useState(() => preferredTrack(subtitles, playerPrefs.subtitle()))

  // Janela flutuante: com ela aberta nesta aula, o vídeo daqui fica pausado e acompanha o horário de lá (anotações,
  // transcrição e IA continuam usando o horário certo).
  const toast = useToast()
  const pip = usePipStatus()
  const pipHere = pip.open && pip.lessonId === lesson.id
  const pipHereRef = useRef(pipHere)
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: () => window.api.settings.get() })
  const autoOpenRef = useRef(false)
  const playbackRef = useRef<PipPlayback>({ rate, volume, muted, subtitle: 'off' })
  const subtitle = track < 0 ? 'off' : (subtitles[track]?.lang ?? '')
  useEffect(() => {
    pipHereRef.current = pipHere
    autoOpenRef.current = settings.data?.pip.autoOpen ?? false
    playbackRef.current = { rate, volume, muted, subtitle }
  })

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

  /** Velocidade, volume e legenda mudados na janela flutuante passam a valer aqui. */
  const applyPlayback = useCallback(
    (p: PipPlayback) => {
      changeRate(p.rate)
      setVolume(p.volume)
      setMuted(p.muted)
      playerPrefs.setVolume(p.volume)
      playerPrefs.setMuted(p.muted)
      setTrack(preferredTrack(subtitles, p.subtitle))
      playerPrefs.setSubtitle(p.subtitle)
    },
    // `subtitles` é recriado a cada render, mas só muda com a aula (e o player é recriado a cada aula).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [changeRate, lesson.id]
  )

  const pipRequest = useCallback(
    (video: HTMLVideoElement): PipOpenRequest => ({
      lessonId: lesson.id,
      time: video.currentTime,
      playing: !video.paused,
      playback: playbackRef.current,
      autoplayNext: playerPrefs.autoplay()
    }),
    [lesson.id]
  )

  const openPip = useCallback(() => {
    const video = videoRef.current
    if (!video || error || pipHereRef.current) return
    if (document.fullscreenElement) void document.exitFullscreen()
    const request = pipRequest(video)
    video.pause()
    window.api.pip
      .open(request)
      .then((status) => {
        if (!status.onTop) toast('Neste sistema a janela flutuante não fica por cima sozinha: use Alt+Espaço → "Sempre visível".')
      })
      .catch((e) => toast(errorMessage(e), 'error'))
  }, [videoRef, error, pipRequest, toast])

  /** Fecha a janela flutuante e continua aqui, do ponto em que ela estava. */
  const bringBack = useCallback(() => {
    const { time, paused } = pipStatus()
    pipHereRef.current = false
    void window.api.pip.close().then(() => {
      const video = videoRef.current
      if (!video) return
      video.currentTime = time
      if (!paused) video.play().catch(() => {})
    })
  }, [videoRef])

  // Eventos da janela flutuante: fechou (fica pausado onde ela parou), trocou de aula (o app acompanha) e
  // "voltar ao app" (continua tocando aqui).
  useEffect(() => {
    let wasHere = pipStatus().open && pipStatus().lessonId === lesson.id
    const offEvents = onPipEvent((event) => {
      const video = videoRef.current
      if (event.type !== 'status') return
      const s = event.status
      const here = s.open && s.lessonId === lesson.id
      if (wasHere && !here) {
        if (s.open && s.lessonId !== null) onPipFollow?.(s.lessonId)
        else {
          if (video) video.currentTime = syncTarget(s.time, video.duration)
          if (s.playback) applyPlayback(s.playback)
        }
      } else if (here && video) {
        video.pause()
        // Tocando lá, meio segundo de diferença não importa; pausado, fica no ponto exato. Nunca encosta no fim:
        // o vídeo daqui "terminaria" e o player começaria a própria contagem para a próxima aula.
        const target = syncTarget(s.time, video.duration)
        if (Math.abs(video.currentTime - target) > (s.paused ? 0.05 : 0.5)) video.currentTime = target
      }
      wasHere = here
    })
    setPipReturnTarget((event) => {
      const video = videoRef.current
      if (event.lessonId !== lesson.id || !video) return false
      applyPlayback(event.playback)
      video.currentTime = event.time
      if (event.playing) video.play().catch(() => {})
      return true
    })
    return () => {
      offEvents()
      setPipReturnTarget(null)
    }
  }, [lesson.id, videoRef, applyPlayback, onPipFollow])

  // Abrir sozinha ao sair do player com o vídeo tocando (preferência). Roda antes de o vídeo sair da tela, quando
  // ainda dá para ler se ele estava tocando; a troca de aula (continua no player) não conta.
  useLayoutEffect(() => {
    const video = videoRef.current
    return () => {
      if (!video || video.paused || video.ended || pipHereRef.current || !autoOpenRef.current) return
      const request = { ...pipRequest(video), playing: true }
      setTimeout(() => {
        if (!window.location.hash.startsWith('#/lesson/')) void window.api.pip.open(request).catch(() => {})
      }, 0)
    }
  }, [videoRef, pipRequest])

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
        case 'p':
          openPip()
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
  }, [togglePlay, seekBy, changeVolume, toggleMute, toggleFullscreen, stepRate, onNext, showControls, openPip])

  useEffect(() => () => clearTimeout(hideTimer.current), [])

  const onLoadedMetadata = () => {
    const video = videoRef.current!
    // Reforço: faixa de vídeo que o navegador não decodifica chega com dimensão zero.
    if (video.videoWidth === 0 && video.videoHeight === 0 && lesson.kind === 'video') {
      setError(true)
      return
    }
    setDuration(video.duration)
    if (Number.isFinite(video.duration) && video.duration > 0 && lesson.durationSec === null) {
      window.api.lessons.setDuration(lesson.id, video.duration).catch(() => {})
    }
    // Aula tocando na janela flutuante: aqui só acompanha.
    if (pipHereRef.current) {
      video.currentTime = syncTarget(pipStatus().time, video.duration)
      return
    }
    const start = startPosition(startAt, lesson.progress.positionSec, video.duration)
    if (start) {
      video.currentTime = start.sec
      setJump({ sec: start.sec, label: start.resumed ? 'Retomando de' : 'Indo para' })
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
        onPlay={(e) => {
          const video = e.currentTarget
          // Com a janela flutuante aberta nesta aula, "tocar" aqui (ex.: clique num horário da transcrição) toca lá.
          if (pipHereRef.current) {
            video.pause()
            void window.api.pip.command({ type: 'seek', time: video.currentTime, play: true })
            return
          }
          // Um vídeo por vez: tocar aqui pausa a janela flutuante que estiver em outra aula.
          const s = pipStatus()
          if (s.open && !s.paused) void window.api.pip.command({ type: 'pause' })
          setPlaying(true)
          showControls()
        }}
        onPause={() => {
          setPlaying(false)
          setControlsVisible(true)
        }}
        // Com a janela flutuante nesta aula, quem conclui e passa para a próxima é ela.
        onEnded={() => !pipHereRef.current && onEnded()}
        onError={() => setError(true)}
      >
        {subtitles.map((s) => (
          <track key={s.id} kind="subtitles" src={s.url} srcLang={s.lang ?? undefined} label={subtitleLabel(s.lang, s.name)} />
        ))}
      </video>

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 p-6 text-center text-white">
          <p className="font-medium">Este vídeo não pode ser reproduzido aqui</p>
          <ConvertOffer lessonId={lesson.id} />
        </div>
      )}

      {jump !== null && (
        <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-black/75 px-3 py-1 text-sm text-white">
          {jump.label} {formatClock(jump.sec)}
        </div>
      )}

      {pipHere && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/90 p-6 text-center text-white">
          <PictureInPicture2 size={36} className="text-accent" />
          <p className="font-medium">Tocando na janela flutuante</p>
          <p className="text-sm text-white/60">
            {formatClock(pip.time)} / {formatClock(pip.duration || duration)}
          </p>
          <button type="button" onClick={bringBack} className="rounded-md bg-white/15 px-4 py-2 text-sm hover:bg-white/25">
            Trazer de volta para cá
          </button>
        </div>
      )}

      {!playing && !error && !pipHere && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label="Reproduzir"
          className="absolute top-1/2 left-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-accent/90 text-on-accent shadow-lg hover:bg-accent"
        >
          <Play size={28} className="ml-1" fill="currentColor" />
        </button>
      )}

      {!error && !pipHere && (
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
              <button type="button" onClick={openPip} aria-label="Janela flutuante" title="Janela flutuante (P)" className="grid size-8 place-items-center rounded hover:bg-white/15">
                <PictureInPicture2 size={18} />
              </button>
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
