import type { AppSettings } from '@shared/ipc'
import { AI_PROVIDER_IDS, DEFAULT_AI_MODELS, MODEL_NAME, type AiModels } from '@shared/ai'
import type { Database } from './database'

export type { AppSettings }

export const DEFAULT_CONVERSION_ARGS = '-c:v libx264 -crf 23 -preset medium -pix_fmt yuv420p -c:a aac -b:a 128k'

export const DEFAULT_SETTINGS: AppSettings = {
  dailyGoalMinutes: 60,
  notificationsEnabled: true,
  notifyLeadMinutes: 5,
  conversionArgs: DEFAULT_CONVERSION_ARGS,
  transcriptionProvider: 'none',
  transcriptionModel: 'whisper-large-v3-turbo',
  transcriptionLanguage: 'pt',
  localWhisperUrl: 'http://localhost:8000/v1',
  aiProvider: 'none',
  aiModels: DEFAULT_AI_MODELS,
  ollamaUrl: 'http://localhost:11434',
  openaiBaseUrl: 'https://api.openai.com/v1',
  autoBackup: true,
  aiWebSearch: false
}

export const LEAD_OPTIONS = [0, 5, 10, 15] as const

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
  if (patch.notificationsEnabled !== undefined) {
    if (typeof patch.notificationsEnabled !== 'boolean') throw new Error('Valor inválido para notificações')
    out.notificationsEnabled = patch.notificationsEnabled
  }
  if (patch.notifyLeadMinutes !== undefined) {
    if (!LEAD_OPTIONS.includes(patch.notifyLeadMinutes)) throw new Error('Antecedência deve ser 0, 5, 10 ou 15 minutos')
    out.notifyLeadMinutes = patch.notifyLeadMinutes
  }
  if (patch.conversionArgs !== undefined) {
    const args = String(patch.conversionArgs).trim()
    if (!args || args.length > 500) throw new Error('Parâmetros de conversão inválidos')
    // Entrada e saída são do app; aqui só entram as opções de codificação.
    if (/(^|\s)-(i|y|n)(\s|$)/.test(args)) throw new Error('Os parâmetros não podem incluir -i, -y ou -n')
    out.conversionArgs = args
  }
  if (patch.transcriptionProvider !== undefined) {
    if (!['none', 'groq', 'local'].includes(patch.transcriptionProvider)) throw new Error('Provedor de transcrição inválido')
    out.transcriptionProvider = patch.transcriptionProvider
  }
  if (patch.transcriptionModel !== undefined) {
    const model = String(patch.transcriptionModel).trim()
    if (!/^[\w.:/-]{1,100}$/.test(model)) throw new Error('Nome de modelo inválido')
    out.transcriptionModel = model
  }
  if (patch.transcriptionLanguage !== undefined) {
    const lang = String(patch.transcriptionLanguage).trim().toLowerCase()
    if (lang && !/^[a-z]{2,3}$/.test(lang)) throw new Error('Idioma deve ser um código como "pt" ou "en" (ou vazio para detectar)')
    out.transcriptionLanguage = lang
  }
  if (patch.localWhisperUrl !== undefined) {
    const url = String(patch.localWhisperUrl).trim()
    if (!/^https?:\/\/[^\s/]+/.test(url)) throw new Error('URL do servidor local inválida')
    out.localWhisperUrl = url.replace(/\/+$/, '')
  }
  if (patch.aiProvider !== undefined) {
    if (patch.aiProvider !== 'none' && !AI_PROVIDER_IDS.includes(patch.aiProvider)) throw new Error('Provedor de IA inválido')
    out.aiProvider = patch.aiProvider
  }
  if (patch.aiModels !== undefined) {
    const models = { ...DEFAULT_AI_MODELS } as AiModels
    for (const id of AI_PROVIDER_IDS) {
      const value = (patch.aiModels as Partial<AiModels> | null)?.[id]
      if (value === undefined) continue
      const model = String(value).trim()
      if (!MODEL_NAME.test(model)) throw new Error('Nome de modelo inválido')
      models[id] = model
    }
    out.aiModels = models
  }
  if (patch.aiWebSearch !== undefined) {
    if (typeof patch.aiWebSearch !== 'boolean') throw new Error('Valor inválido para pesquisa na internet')
    out.aiWebSearch = patch.aiWebSearch
  }
  if (patch.autoBackup !== undefined) {
    if (typeof patch.autoBackup !== 'boolean') throw new Error('Valor inválido para backup automático')
    out.autoBackup = patch.autoBackup
  }
  for (const key of ['ollamaUrl', 'openaiBaseUrl'] as const) {
    if (patch[key] === undefined) continue
    const url = String(patch[key]).trim()
    if (!/^https?:\/\/[^\s/]+/.test(url)) throw new Error('Endereço do servidor inválido')
    out[key] = url.replace(/\/+$/, '')
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

/** Valores internos (fora das preferências visíveis), ex.: data do último resumo diário. */
export function getInternal(db: Database, key: string): unknown {
  const row = db.prepare('SELECT value_json AS value FROM settings WHERE key = ?').get(`internal.${key}`) as { value: string } | undefined
  try {
    return row ? JSON.parse(row.value) : undefined
  } catch {
    return undefined
  }
}

export function setInternal(db: Database, key: string, value: unknown): void {
  db.prepare(
    'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json'
  ).run(`internal.${key}`, JSON.stringify(value))
}
