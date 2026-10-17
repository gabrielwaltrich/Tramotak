import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { PomodoroSettings as PomodoroPrefs } from '@shared/pomodoro'
import { errorMessage, queryKeys } from '../../lib/api'
import { Choice, Toggle } from '../SettingControls'
import { useToast } from '../Toast'

const FOCUS = [20, 25, 30, 45, 50, 60]
const SHORT = [3, 5, 10, 15]
const LONG = [10, 15, 20, 30]
const EVERY = [2, 3, 4, 5, 6]

/** Opções do Pomodoro. Valem na próxima fase (a que está rodando segue até o fim). */
export function PomodoroSettings({ settings: saved }: { settings: PomodoroPrefs }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [settings, setSettings] = useState(saved)
  const save = useMutation({
    mutationFn: (next: PomodoroPrefs) => window.api.settings.update({ pomodoro: next }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
    onError: (error) => {
      setSettings(saved)
      toast(errorMessage(error), 'error')
    }
  })
  const set = (patch: Partial<PomodoroPrefs>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    save.mutate(next)
  }
  const options = (list: number[], current: number) => [...new Set([...list, current])].sort((a, b) => a - b).map((n) => ({ value: n, label: `${n} min` }))

  return (
    <div className="space-y-4">
      <Choice label="Foco" value={settings.focusMinutes} options={options(FOCUS, settings.focusMinutes)} onChange={(focusMinutes) => set({ focusMinutes })} />
      <Choice label="Pausa curta" value={settings.shortBreakMinutes} options={options(SHORT, settings.shortBreakMinutes)} onChange={(shortBreakMinutes) => set({ shortBreakMinutes })} />
      <Choice label="Pausa longa" value={settings.longBreakMinutes} options={options(LONG, settings.longBreakMinutes)} onChange={(longBreakMinutes) => set({ longBreakMinutes })} />
      <Choice
        label="Pausa longa a cada"
        value={settings.longBreakEvery}
        options={[...new Set([...EVERY, settings.longBreakEvery])].sort((a, b) => a - b).map((n) => ({ value: n, label: `${n} focos` }))}
        onChange={(longBreakEvery) => set({ longBreakEvery })}
      />
      <Toggle checked={settings.autoStartBreaks} onChange={(autoStartBreaks) => set({ autoStartBreaks })}>
        Começar a pausa sozinha ao terminar o foco
      </Toggle>
      <Toggle checked={settings.autoStartFocus} onChange={(autoStartFocus) => set({ autoStartFocus })}>
        Começar o próximo foco sozinho ao terminar a pausa
      </Toggle>
      <Toggle checked={settings.notify} onChange={(notify) => set({ notify })}>
        Aviso do sistema no fim de cada foco e pausa
      </Toggle>
      <p className="text-xs text-muted">
        Use pelo botão <strong>Foco</strong> na barra superior. Um bloco de foco conta no tempo de estudo e na meta diária mesmo estudando fora
        do app; o que o Tramotak já mediu no período (vídeo, PDF, flashcards) não é contado duas vezes. Ao fechar o app, o bloco é pausado.
      </p>
    </div>
  )
}
