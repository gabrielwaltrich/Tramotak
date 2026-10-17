import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { REVIEW_COUNTS, type ReviewSettings as ReviewPrefs } from '@shared/review'
import { errorMessage, queryKeys } from '../../lib/api'
import { Choice, Toggle } from '../SettingControls'
import { useToast } from '../Toast'

/** Preferências da revisão pós-aula (Configurações → Inteligência artificial). */
export function ReviewSettings({ settings: saved }: { settings: ReviewPrefs }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [settings, setSettings] = useState(saved)
  const save = useMutation({
    mutationFn: (next: ReviewPrefs) => window.api.settings.update({ review: next }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
    onError: (error) => {
      setSettings(saved)
      toast(errorMessage(error), 'error')
    }
  })
  const set = (patch: Partial<ReviewPrefs>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    save.mutate(next)
  }

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <h3 className="text-sm font-medium">Revisão pós-aula</h3>
      <Toggle checked={settings.enabled} onChange={(enabled) => set({ enabled })}>
        Oferecer perguntas rápidas sobre o assunto ao concluir uma aula
      </Toggle>
      <Choice
        label="Perguntas"
        value={settings.count}
        options={REVIEW_COUNTS.map((n) => ({ value: n, label: String(n) }))}
        onChange={(count) => set({ count })}
      />
      <p className="text-xs text-muted">
        As perguntas são geradas só quando você pede, a partir da transcrição, legenda ou texto da aula. O botão{' '}
        <strong>Revisão rápida</strong> no player funciona mesmo com a oferta desligada.
      </p>
    </div>
  )
}
