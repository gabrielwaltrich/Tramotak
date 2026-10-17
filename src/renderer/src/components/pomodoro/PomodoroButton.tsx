import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Pause, Play, RotateCcw, SkipForward, Timer } from 'lucide-react'
import { formatDuration } from '@shared/format'
import { formatTimer, PHASE_LABEL, phaseMs } from '@shared/pomodoro'
import type { PomodoroCommand } from '@shared/ipc'
import { dayKey } from '@shared/streak'
import { errorMessage, queryKeys } from '../../lib/api'
import { usePomodoro } from '../../lib/usePomodoro'
import { useToast } from '../Toast'

/** Pomodoro na barra superior: o tempo da fase e, ao clicar, os controles e o estudo do dia. */
export function PomodoroButton() {
  const { view, remainingMs } = usePomodoro()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const toast = useToast()
  const dashboard = useQuery({ queryKey: queryKeys.dashboard, queryFn: () => window.api.dashboard.get(), enabled: open })

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Ao abrir o painel ou mudar de fase, o tempo de estudo do dia é recarregado.
  const phase = view?.state.phase
  useEffect(() => {
    if (open) void dashboard.refetch()
  }, [open, phase]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!view) return null
  const { state, settings } = view
  const run = (cmd: PomodoroCommand) => window.api.pomodoro.command(cmd).catch((e) => toast(errorMessage(e), 'error'))
  const started = state.running || state.remainingMs < phaseMs(state.phase, settings)
  const focus = state.phase === 'focus'
  const tone = focus ? 'text-accent' : 'text-success'
  const blocksToday = state.today.day === dayKey(new Date()) ? state.today.blocks : 0
  const inSet = state.cycle % settings.longBreakEvery
  const goal = dashboard.data ? dashboard.data.goalMinutes * 60 : null

  return (
    <div ref={ref} className="relative ml-3 shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={started ? `Pomodoro: ${PHASE_LABEL[state.phase]}, ${formatTimer(remainingMs)}${state.running ? '' : ' (pausado)'}` : 'Pomodoro'}
        title="Pomodoro"
        className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium tabular-nums ${
          started ? `border-current/40 ${tone} bg-surface` : 'border-border text-muted hover:text-text'
        }`}
      >
        <Timer size={14} />
        {started ? formatTimer(remainingMs) : 'Foco'}
        {started && !state.running && <Pause size={11} aria-hidden />}
      </button>

      {open && (
        <div role="dialog" aria-label="Pomodoro" className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-border bg-surface p-4 shadow-2xl">
          <p className={`text-xs font-medium tracking-wide uppercase ${tone}`}>{PHASE_LABEL[state.phase]}</p>
          <p className="mt-1 text-4xl font-semibold tabular-nums" aria-live="off">
            {formatTimer(remainingMs)}
          </p>
          <div className="mt-2 flex items-center gap-1.5" aria-label={`${inSet} de ${settings.longBreakEvery} blocos até a pausa longa`}>
            {Array.from({ length: settings.longBreakEvery }, (_, i) => (
              <span key={i} className={`size-2 rounded-full ${i < inSet ? 'bg-accent' : 'bg-border'}`} />
            ))}
          </div>

          <div className="mt-4 flex items-center gap-2">
            {state.running ? (
              <button type="button" onClick={() => void run('pause')} className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-surface-2 text-sm font-medium hover:brightness-125">
                <Pause size={16} /> Pausar
              </button>
            ) : (
              <button type="button" onClick={() => void run('start')} className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-accent text-sm font-medium text-on-accent hover:brightness-110">
                <Play size={16} /> {started ? 'Continuar' : focus ? 'Começar foco' : 'Começar pausa'}
              </button>
            )}
            <button type="button" onClick={() => void run('skip')} aria-label={focus ? 'Pular para a pausa' : 'Pular a pausa'} title={focus ? 'Pular para a pausa' : 'Pular a pausa'} className="grid size-9 place-items-center rounded-md border border-border text-muted hover:text-text">
              <SkipForward size={16} />
            </button>
            <button type="button" onClick={() => void run('reset')} aria-label="Recomeçar" title="Recomeçar do primeiro foco" className="grid size-9 place-items-center rounded-md border border-border text-muted hover:text-text">
              <RotateCcw size={16} />
            </button>
          </div>

          <div className="mt-4 space-y-1 border-t border-border pt-3 text-xs text-muted">
            <p>
              Hoje: {blocksToday} {blocksToday === 1 ? 'bloco' : 'blocos'} de foco
              {dashboard.data && ` · ${formatDuration(dashboard.data.todaySeconds)} de estudo`}
            </p>
            {goal !== null && dashboard.data && (
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" title={`Meta diária: ${dashboard.data.goalMinutes} min`}>
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (dashboard.data.todaySeconds / goal) * 100)}%` }} />
              </div>
            )}
            <p>
              O tempo de foco conta na meta (sem repetir o que o app já mediu).{' '}
              <Link to="/settings#pomodoro" onClick={() => setOpen(false)} className="text-accent hover:underline">
                Ajustar
              </Link>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
