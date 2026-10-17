import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  PIP_CORNERS,
  PIP_OPACITY_MIN,
  PIP_SEEK_STEPS,
  PIP_SIZES,
  type PipButtons,
  type PipSettings as PipPrefs
} from '@shared/pip'
import { errorMessage, queryKeys } from '../../lib/api'
import { useToast } from '../Toast'
import { Choice, Toggle } from '../SettingControls'

const BUTTONS: { id: keyof PipButtons; label: string }[] = [
  { id: 'volume', label: 'Volume' },
  { id: 'subtitles', label: 'Legenda' },
  { id: 'opacity', label: 'Transparência' },
  { id: 'speed', label: 'Velocidade' },
  { id: 'lessons', label: 'Aula anterior e próxima' }
]

/** Preferências da janela flutuante do player. Valem na hora, inclusive com a janela aberta. */
export function PipSettings({ settings: saved }: { settings: PipPrefs }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  // Cópia local: a escolha aparece na hora, sem esperar o banco. A opacidade muda ao arrastar e só grava ao soltar.
  const [settings, setSettings] = useState(saved)
  const [opacity, setOpacity] = useState(saved.opacity)
  const save = useMutation({
    mutationFn: (next: PipPrefs) => window.api.settings.update({ pip: next }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
    onError: (error) => {
      setSettings(saved)
      toast(errorMessage(error), 'error')
    }
  })
  const set = (patch: Partial<PipPrefs>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    save.mutate(next)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="pip-opacity" className="w-40 text-muted">
          Opacidade
        </label>
        <input
          id="pip-opacity"
          type="range"
          min={PIP_OPACITY_MIN}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(e) => setOpacity(Number(e.target.value))}
          onPointerUp={() => set({ opacity })}
          onKeyUp={() => set({ opacity })}
          className="h-1 w-48 cursor-pointer accent-[var(--accent)]"
        />
        <span className="w-10 tabular-nums">{Math.round(opacity * 100)}%</span>
      </div>
      <Toggle checked={settings.hoverOpaque} onChange={(hoverOpaque) => set({ hoverOpaque })}>
        Ficar opaca com o mouse em cima (para enxergar os botões)
      </Toggle>

      <Choice
        label="Voltar/avançar"
        value={settings.seekStep}
        options={PIP_SEEK_STEPS.map((s) => ({ value: s, label: `${s} s` }))}
        onChange={(seekStep) => set({ seekStep })}
      />
      <Choice label="Tamanho inicial" value={settings.size} options={PIP_SIZES.map((s) => ({ value: s.id, label: s.label }))} onChange={(size) => set({ size })} />
      <Choice label="Canto inicial" value={settings.corner} options={PIP_CORNERS.map((c) => ({ value: c.id, label: c.label }))} onChange={(corner) => set({ corner })} />
      <Toggle checked={settings.rememberBounds} onChange={(rememberBounds) => set({ rememberBounds })}>
        Reabrir onde e do tamanho que estava da última vez
      </Toggle>
      <Toggle checked={settings.autoOpen} onChange={(autoOpen) => set({ autoOpen })}>
        Abrir sozinha ao sair do player com o vídeo tocando
      </Toggle>

      <fieldset>
        <legend className="mb-2 text-sm text-muted">Botões na janela (tocar/pausar, voltar/avançar e fechar sempre aparecem)</legend>
        <div className="grid grid-cols-2 gap-2">
          {BUTTONS.map((b) => (
            <Toggle key={b.id} checked={settings.buttons[b.id]} onChange={(on) => set({ buttons: { ...settings.buttons, [b.id]: on } })}>
              {b.label}
            </Toggle>
          ))}
        </div>
      </fieldset>

      <p className="text-xs text-muted">
        Abra pelo botão <strong>Janela flutuante</strong> no player ou pela tecla <kbd>P</kbd>. Na janela: arraste para mover, puxe um
        canto para redimensionar e use espaço, ← → (voltar/avançar), ↑ ↓ (volume), M (som) e C (legenda).
      </p>
    </div>
  )
}
