import { useState } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import {
  ACCENTS,
  accentVars,
  CORNERS,
  DEFAULT_APPEARANCE,
  DENSITIES,
  FONTS,
  PRESETS,
  resolveTheme,
  themeMode,
  THEMES,
  type Appearance
} from '@shared/appearance'
import { getAppearance, setAppearance } from '../theme'
import { Segmented } from './Field'

const same = (a: Appearance, b: Appearance) => (Object.keys(a) as (keyof Appearance)[]).every((k) => a[k] === b[k])

const RADIUS = { square: 2, normal: 6, round: 12 } as const

/** Miniatura de um estilo pronto, desenhada com as cores dele (não com as do tema atual). */
function PresetPreview({ values }: { values: Appearance }) {
  const theme = resolveTheme(values.theme, false)
  const t = THEMES.find((x) => x.id === theme)!
  const accent = accentVars(values.accent, t.mode)
  const r = RADIUS[values.corners]
  const line = t.mode === 'dark' ? 'rgb(255 255 255 / 0.18)' : 'rgb(0 0 0 / 0.14)'
  return (
    <div className="flex h-16 overflow-hidden border border-black/10" style={{ background: t.swatch[0], borderRadius: r + 2 }} aria-hidden>
      <div className="flex w-1/4 flex-col gap-1 p-1.5" style={{ background: t.swatch[1] }}>
        <span className="h-1.5 w-3/4" style={{ background: accent['--accent'], borderRadius: r / 2 }} />
        <span className="h-1 w-full" style={{ background: line, borderRadius: r / 2 }} />
        <span className="h-1 w-2/3" style={{ background: line, borderRadius: r / 2 }} />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        <span className="h-1.5 w-1/2" style={{ background: line, borderRadius: r / 2 }} />
        <div className="flex-1 p-1" style={{ background: t.swatch[1], borderRadius: r }}>
          <span className="block h-1 w-2/3" style={{ background: line, borderRadius: r / 2 }} />
        </div>
        <span className="h-2.5 w-8 self-end" style={{ background: accent['--accent'], borderRadius: r / 2 }} />
      </div>
    </div>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      {children}
    </div>
  )
}

export function AppearanceSettings() {
  const [current, setCurrent] = useState<Appearance>(getAppearance)
  const update = (patch: Partial<Appearance>) => {
    const next = { ...current, ...patch }
    setCurrent(next)
    setAppearance(next)
  }
  const mode = themeMode(resolveTheme(current.theme, window.matchMedia('(prefers-color-scheme: light)').matches))

  return (
    <div className="space-y-6">
      <Group label="Estilos prontos">
        <div role="radiogroup" aria-label="Estilos prontos" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {PRESETS.map((p) => {
            const active = same(current, p.values)
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => update(p.values)}
                className={`rounded-lg border p-2 text-left transition ${active ? 'border-accent ring-1 ring-accent' : 'border-border hover:bg-surface-2'}`}
              >
                <PresetPreview values={p.values} />
                <span className="mt-2 flex items-center gap-1 text-sm font-medium">
                  {active && <Check size={14} className="text-accent" />}
                  {p.label}
                </span>
                <span className="block text-xs text-muted">{p.description}</span>
              </button>
            )
          })}
        </div>
      </Group>

      <Group label="Tema">
        <div role="radiogroup" aria-label="Tema" className="flex flex-wrap gap-2">
          {[{ id: 'system' as const, label: 'Sistema', swatch: ['#0b0b0f', '#f7f7fa'] as [string, string] }, ...THEMES].map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={current.theme === t.id}
              onClick={() => update({ theme: t.id })}
              className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${
                current.theme === t.id ? 'border-accent bg-accent-soft text-accent' : 'border-border text-muted hover:text-text'
              }`}
            >
              <span className="flex size-4 overflow-hidden rounded-full border border-black/20" aria-hidden>
                <span className="flex-1" style={{ background: t.swatch[0] }} />
                <span className="flex-1" style={{ background: t.swatch[1] }} />
              </span>
              {t.label}
            </button>
          ))}
        </div>
      </Group>

      <Group label="Cor de destaque">
        <div role="radiogroup" aria-label="Cor de destaque" className="flex flex-wrap gap-3">
          {ACCENTS.map((a) => {
            const color = mode === 'dark' ? a.dark : a.light
            const active = current.accent === a.id
            return (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={a.label}
                title={a.label}
                onClick={() => update({ accent: a.id })}
                className={`grid size-9 place-items-center rounded-full ring-offset-2 ring-offset-surface transition ${active ? 'ring-2 ring-text' : 'hover:scale-110'}`}
                style={{ background: color }}
              >
                {active && <Check size={16} style={{ color: accentVars(a.id, mode)['--on-accent'] }} />}
              </button>
            )
          })}
        </div>
        <p className="mt-2 text-xs text-muted">{ACCENTS.find((a) => a.id === current.accent)?.label} · usada em botões, seleção, gráficos e no nó central dos mapas.</p>
      </Group>

      <div className="grid gap-6 sm:grid-cols-2">
        <Group label="Tamanho da interface">
          <Segmented label="Tamanho da interface" value={current.density} onChange={(density) => update({ density })} options={DENSITIES.map((d) => ({ value: d.id, label: d.label }))} />
        </Group>
        <Group label="Cantos">
          <Segmented label="Cantos" value={current.corners} onChange={(corners) => update({ corners })} options={CORNERS.map((c) => ({ value: c.id, label: c.label }))} />
        </Group>
        <Group label="Fonte">
          <Segmented label="Fonte" value={current.font} onChange={(font) => update({ font })} options={FONTS.map((f) => ({ value: f.id, label: f.label }))} />
        </Group>
        <Group label="Movimento">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={current.reduceMotion} onChange={(e) => update({ reduceMotion: e.target.checked })} className="size-4 accent-[var(--accent)]" />
            Reduzir animações
          </label>
        </Group>
      </div>

      {!same(current, DEFAULT_APPEARANCE) && (
        <button type="button" onClick={() => update(DEFAULT_APPEARANCE)} className="inline-flex items-center gap-1 text-xs text-muted hover:text-text">
          <RotateCcw size={12} /> Voltar ao visual padrão
        </button>
      )}
    </div>
  )
}
