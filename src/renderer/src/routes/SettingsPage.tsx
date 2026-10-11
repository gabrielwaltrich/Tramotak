import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/ipc'
import { PageHeader } from '../components/PageHeader'
import { getStoredTheme, setTheme, type Theme } from '../theme'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'dark', label: 'Escuro' },
  { value: 'light', label: 'Claro' },
  { value: 'system', label: 'Sistema' }
]

export function SettingsPage() {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme)
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    window.api.app.info().then(setInfo)
  }, [])

  const choose = (value: Theme) => {
    setTheme(value)
    setThemeState(value)
  }

  return (
    <div className="mx-auto max-w-3xl p-8">
      <PageHeader title="Configurações" />

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="font-medium">Aparência</h2>
        <p className="mt-1 text-sm text-muted">Tema da interface.</p>
        <div role="radiogroup" aria-label="Tema" className="mt-4 inline-flex rounded-lg border border-border p-1">
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
      </section>

      <section className="mt-4 rounded-xl border border-border bg-surface p-5 text-sm">
        <h2 className="font-medium">Sobre</h2>
        {info ? (
          <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-y-1 text-muted">
            <dt>Versão</dt>
            <dd className="text-text">{info.version}</dd>
            <dt>Sistema</dt>
            <dd className="text-text">{info.platform}</dd>
            <dt>Electron</dt>
            <dd className="text-text">{info.electron}</dd>
          </dl>
        ) : (
          <p className="mt-3 text-muted">Carregando…</p>
        )}
      </section>
    </div>
  )
}
