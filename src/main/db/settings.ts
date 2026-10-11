import type { AppSettings } from '@shared/ipc'
import type { Database } from './database'

export type { AppSettings }

export const DEFAULT_SETTINGS: AppSettings = { dailyGoalMinutes: 60 }

export const GOAL_LIMITS = { min: 5, max: 480 }

function validate(patch: Partial<AppSettings>): Partial<AppSettings> {
  const out: Partial<AppSettings> = {}
  if (patch.dailyGoalMinutes !== undefined) {
    const value = Number(patch.dailyGoalMinutes)
    if (!Number.isInteger(value) || value < GOAL_LIMITS.min || value > GOAL_LIMITS.max) {
      throw new Error(`A meta diária deve ficar entre ${GOAL_LIMITS.min} e ${GOAL_LIMITS.max} minutos`)
    }
    out.dailyGoalMinutes = value
  }
  return out
}

export function getSettings(db: Database): AppSettings {
  const rows = db.prepare('SELECT key, value_json AS value FROM settings').all() as { key: string; value: string }[]
  const stored: Record<string, unknown> = {}
  for (const row of rows) {
    try {
      stored[row.key] = JSON.parse(row.value)
    } catch {
      // valor corrompido: cai no padrão
    }
  }
  // Valores guardados fora da faixa (versões antigas, edição manual) voltam ao padrão.
  const merged = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
    if (key in stored) {
      try {
        Object.assign(merged, validate({ [key]: stored[key] } as Partial<AppSettings>))
      } catch {
        // mantém o padrão
      }
    }
  }
  return merged
}

export function updateSettings(db: Database, patch: Partial<AppSettings>): AppSettings {
  const valid = validate(patch)
  const upsert = db.prepare(
    'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json'
  )
  for (const [key, value] of Object.entries(valid)) upsert.run(key, JSON.stringify(value))
  return getSettings(db)
}
