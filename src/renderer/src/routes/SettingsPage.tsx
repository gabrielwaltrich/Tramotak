import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderOpen } from 'lucide-react'
import { errorMessage, queryKeys } from '../lib/api'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/Button'
import { GOAL_MAX, GOAL_MIN } from '../components/GoalCard'
import { useToast } from '../components/Toast'
import { getStoredTheme, setTheme, type Theme } from '../theme'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'dark', label: 'Escuro' },
  { value: 'light', label: 'Claro' },
  { value: 'system', label: 'Sistema' }
]

const GOAL_PRESETS = [15, 30, 60, 90, 120]

/** 45 → "45 min", 60 → "1h", 90 → "1h30". */
function formatGoal(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const rest = minutes % 60
  return `${Math.floor(minutes / 60)}h${rest ? String(rest).padStart(2, '0') : ''}`
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="font-medium">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function GoalSetting({ current }: { current: number }) {
  const [draft, setDraft] = useState(String(current))
  const queryClient = useQueryClient()
  const toast = useToast()

  const save = useMutation({
    mutationFn: (minutes: number) => window.api.settings.update({ dailyGoalMinutes: minutes }),
    onSuccess: async (settings) => {
      setDraft(String(settings.dailyGoalMinutes))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
      ])
      toast(`Meta diária: ${settings.dailyGoalMinutes} min`)
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  const dirty = Number(draft) !== current

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {GOAL_PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => save.mutate(m)}
            aria-pressed={current === m}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              current === m ? 'border-accent bg-accent-soft text-accent' : 'border-border text-muted hover:text-text'
            }`}
          >
            {formatGoal(m)}
          </button>
        ))}
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate(Number(draft))
        }}
      >
        <label htmlFor="goal" className="text-sm text-muted">
          Ou digite:
        </label>
        <input
          id="goal"
          type="number"
          min={GOAL_MIN}
          max={GOAL_MAX}
          step={5}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-9 w-24 rounded-md border border-border bg-bg px-3 text-sm tabular-nums select-text focus:border-accent focus:outline-none"
        />
        <span className="text-sm text-muted">min por dia</span>
        {dirty && (
          <Button type="submit" disabled={save.isPending}>
            Salvar
          </Button>
        )}
      </form>
      <p className="text-xs text-muted">
        Entre {GOAL_MIN} e {GOAL_MAX} minutos. Conta o tempo em que um vídeo está tocando, ajustado pela velocidade.
      </p>
    </div>
  )
}

export function SettingsPage() {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme)
  const info = useQuery({ queryKey: ['app-info'], queryFn: () => window.api.app.info() })
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: () => window.api.settings.get(), staleTime: 0 })
  const toast = useToast()

  const choose = (value: Theme) => {
    setTheme(value)
    setThemeState(value)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-8">
      <PageHeader title="Configurações" />

      <Section title="Aparência" description="Tema da interface.">
        <div role="radiogroup" aria-label="Tema" className="inline-flex rounded-lg border border-border p-1">
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={theme === t.value}
              onClick={() => choose(t.value)}
              className={`rounded-md px-4 py-1.5 text-sm ${
                theme === t.value ? 'bg-accent-soft text-accent' : 'text-muted hover:text-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Meta diária" description="Quantos minutos você quer estudar por dia. Aparece na tela Início.">
        {settings.data ? <GoalSetting key={settings.data.dailyGoalMinutes} current={settings.data.dailyGoalMinutes} /> : null}
      </Section>

      <Section title="Dados" description="Biblioteca, progresso e anotações ficam só neste computador.">
        {info.data && (
          <div className="flex items-center gap-3">
            <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-bg px-3 py-2 text-xs select-text" title={info.data.dataPath}>
              {info.data.dataPath}
            </code>
            <Button variant="ghost" onClick={() => window.api.app.openDataFolder().catch((e) => toast(errorMessage(e), 'error'))}>
              <FolderOpen size={16} /> Abrir pasta
            </Button>
          </div>
        )}
      </Section>

      <Section title="Sobre">
        {info.data ? (
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm text-muted">
            <dt>Versão</dt>
            <dd className="text-text">{info.data.version}</dd>
            <dt>Sistema</dt>
            <dd className="text-text">{info.data.platform}</dd>
            <dt>Electron</dt>
            <dd className="text-text">{info.data.electron}</dd>
          </dl>
        ) : (
          <p className="text-sm text-muted">Carregando…</p>
        )}
      </Section>
    </div>
  )
}
