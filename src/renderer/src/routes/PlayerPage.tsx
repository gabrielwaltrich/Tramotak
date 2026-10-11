import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, ChevronLeft, ChevronRight, ExternalLink, Loader2, Star } from 'lucide-react'
import type { LessonView } from '@shared/course'
import { errorMessage, queryKeys } from '../lib/api'
import { VideoPlayer } from '../components/player/VideoPlayer'
import { TextLesson } from '../components/player/TextLesson'
import { DocumentLesson } from '../components/player/DocumentLesson'
import { LessonSidebar } from '../components/player/LessonSidebar'
import { NotesPanel } from '../components/player/NotesPanel'
import { playerPrefs } from '../components/player/prefs'
import { useToast } from '../components/Toast'

const NEXT_COUNTDOWN_SEC = 3

/** Remonta a página a cada aula: estado local (contagem, foco, player) começa do zero. */
export function PlayerPage() {
  const { id } = useParams()
  return <LessonPlayer key={id} lessonId={Number(id)} />
}

function LessonPlayer({ lessonId }: { lessonId: number }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [autoplay, setAutoplay] = useState(playerPrefs.autoplay)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [tab, setTab] = useState<'notes' | 'attachments'>('notes')
  const playerRef = useRef<HTMLDivElement>(null)

  const lesson = useQuery({ queryKey: queryKeys.lesson(lessonId), queryFn: () => window.api.lessons.get(lessonId), staleTime: 0 })
  const courseId = lesson.data?.course.id
  const course = useQuery({
    queryKey: queryKeys.course(courseId ?? -1),
    queryFn: () => window.api.courses.get(courseId!),
    enabled: courseId !== undefined
  })

  // Ao sair do player, cartões e detalhes precisam refletir o novo progresso.
  useEffect(() => () => void queryClient.invalidateQueries({ queryKey: queryKeys.courses }), [queryClient, lessonId])

  const notes = useQuery({ queryKey: queryKeys.notes(lessonId), queryFn: () => window.api.notes.list(lessonId) })
  const isVideo = lesson.data?.kind === 'video'

  const getTime = useCallback(() => (isVideo ? (videoRef.current?.currentTime ?? 0) : null), [isVideo])

  const seek = useCallback((sec: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = sec
    video.play().catch(() => {})
    playerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [])

  const patchLesson = (patch: Partial<LessonView['progress']>) =>
    queryClient.setQueryData<LessonView>(queryKeys.lesson(lessonId), (old) =>
      old ? { ...old, progress: { ...old.progress, ...patch } } : old
    )

  const setCompleted = useMutation({
    mutationFn: (value: boolean) => window.api.progress.setCompleted(lessonId, value),
    onMutate: (value) => patchLesson({ completed: value }),
    onSuccess: () => courseId !== undefined && queryClient.invalidateQueries({ queryKey: queryKeys.course(courseId) }),
    onError: (error, value) => {
      patchLesson({ completed: !value })
      toast(errorMessage(error), 'error')
    }
  })

  const setFavorite = useMutation({
    mutationFn: (value: boolean) => window.api.lessons.setFavorite(lessonId, value),
    onMutate: (value) => patchLesson({ favorite: value }),
    onError: (error, value) => {
      patchLesson({ favorite: !value })
      toast(errorMessage(error), 'error')
    }
  })

  const next = lesson.data?.next
  const goNext = useCallback(() => next && navigate(`/lesson/${next.id}`), [next, navigate])

  const onEnded = () => {
    if (!lesson.data?.progress.completed) setCompleted.mutate(true)
    if (autoplay && next) setCountdown(NEXT_COUNTDOWN_SEC)
  }

  useEffect(() => {
    if (countdown === null) return
    if (countdown <= 0) {
      goNext()
      return
    }
    const timer = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000)
    return () => clearTimeout(timer)
  }, [countdown, goNext])

  if (lesson.isPending) {
    return (
      <div className="grid h-full place-items-center text-muted">
        <Loader2 className="animate-spin" />
      </div>
    )
  }
  if (lesson.isError) return <p className="p-8 text-sm text-red-400">{errorMessage(lesson.error)}</p>

  const l = lesson.data
  const attachments = l.assets.filter((a) => a.kind === 'attachment')

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_20rem] gap-5 p-5">
      <div className="min-w-0 overflow-y-auto">
        <Link to={`/courses/${l.course.id}`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
          <ArrowLeft size={16} /> {l.course.title}
        </Link>

        <div ref={playerRef} className="relative">
          {l.kind === 'video' ? (
            <VideoPlayer key={l.id} lesson={l} videoRef={videoRef} onEnded={onEnded} onNext={next ? goNext : undefined} />
          ) : l.kind === 'text' ? (
            <TextLesson lessonId={l.id} />
          ) : (
            <DocumentLesson lesson={l} />
          )}

          {countdown !== null && next && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-black/80 text-white">
              <p className="text-sm text-white/70">Próxima aula em {countdown}…</p>
              <p className="max-w-md text-center text-lg font-medium">{next.title}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setCountdown(null)} className="rounded-md bg-white/15 px-4 py-2 text-sm hover:bg-white/25">
                  Cancelar
                </button>
                <button type="button" onClick={goNext} className="rounded-md bg-accent px-4 py-2 text-sm hover:brightness-110">
                  Assistir agora
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {l.moduleTitle && <p className="text-xs text-muted">{l.moduleTitle}</p>}
            <h1 className="text-xl font-semibold tracking-tight">{l.title}</h1>
          </div>
          <button
            type="button"
            onClick={() => setFavorite.mutate(!l.progress.favorite)}
            aria-pressed={l.progress.favorite}
            aria-label={l.progress.favorite ? 'Remover dos favoritos' : 'Favoritar'}
            className={`grid size-9 place-items-center rounded-md border border-border hover:bg-surface-2 ${
              l.progress.favorite ? 'text-warning' : 'text-muted'
            }`}
          >
            <Star size={18} fill={l.progress.favorite ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            onClick={() => setCompleted.mutate(!l.progress.completed)}
            aria-pressed={l.progress.completed}
            className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium ${
              l.progress.completed
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-border text-text hover:bg-surface-2'
            }`}
          >
            <Check size={16} /> {l.progress.completed ? 'Concluída' : 'Concluir'}
          </button>
        </div>

        <div className="mt-3 flex items-center gap-4 text-sm">
          {l.prev && (
            <Link to={`/lesson/${l.prev.id}`} className="inline-flex items-center gap-1 text-muted hover:text-text">
              <ChevronLeft size={16} /> Anterior
            </Link>
          )}
          {next && (
            <Link to={`/lesson/${next.id}`} className="inline-flex items-center gap-1 text-muted hover:text-text">
              Próxima <ChevronRight size={16} />
            </Link>
          )}
          {l.kind === 'video' && (
            <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-muted">
              <input
                type="checkbox"
                checked={autoplay}
                onChange={(e) => {
                  setAutoplay(e.target.checked)
                  playerPrefs.setAutoplay(e.target.checked)
                }}
                className="accent-[var(--accent)]"
              />
              Reproduzir a próxima automaticamente
            </label>
          )}
        </div>

        <section className="mt-6 rounded-xl border border-border bg-surface">
          <div role="tablist" className="flex gap-1 border-b border-border px-3 pt-2">
            {(
              [
                ['notes', `Anotações (${notes.data?.length ?? 0})`],
                ...(attachments.length > 0 ? [['attachments', `Anexos (${attachments.length})`]] : [])
              ] as [typeof tab, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                  tab === value ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="p-3">
            {tab === 'notes' || attachments.length === 0 ? (
              <NotesPanel
                lessonId={l.id}
                notes={notes.data ?? []}
                loading={notes.isPending}
                getTime={getTime}
                onSeek={isVideo ? seek : undefined}
              />
            ) : (
              <ul className="space-y-1">
                {attachments.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => window.api.files.openAsset(a.id).catch((e) => toast(errorMessage(e), 'error'))}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                    >
                      <ExternalLink size={14} className="shrink-0 text-muted" />
                      <span className="truncate">{a.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {course.data ? (
        <LessonSidebar course={course.data} currentId={l.id} />
      ) : (
        <div className="rounded-xl border border-border bg-surface" />
      )}
    </div>
  )
}
