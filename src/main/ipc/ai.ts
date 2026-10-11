import { BrowserWindow, ipcMain, shell } from 'electron'
import {
  AI_LINKS,
  AI_PROVIDER_IDS,
  AI_PROVIDERS,
  MODEL_NAME,
  buildPrompt,
  fitSource,
  maxOutputTokens,
  parseResult,
  validateRequest,
  type AiGenerateRequest,
  type AiLink,
  type AiGenerateResponse,
  type AiProvider,
  type AiSourceRef
} from '@shared/ai'
import { IPC, type OllamaPullState } from '@shared/ipc'
import type { Database } from '../db/database'
import { getSettings } from '../db/settings'
import { getSecret, hasSecret, setSecret } from '../secrets'
import { chat, listModels, ollamaPull, ollamaVersion, type AiClientConfig } from '../ai/client'
import { loginOpenRouter } from '../ai/openrouterAuth'
import { resolveSource } from '../ai/source'

function assertProvider(value: unknown): AiProvider {
  if (!AI_PROVIDER_IDS.includes(value as AiProvider)) throw new Error('Provedor de IA inválido')
  return value as AiProvider
}

const secretName = (provider: AiProvider) => `ai.${provider}`

function clientConfig(db: Database, provider: AiProvider): AiClientConfig {
  const settings = getSettings(db)
  return {
    provider,
    model: settings.aiModels[provider],
    apiKey: AI_PROVIDERS[provider].needsKey ? getSecret(db, secretName(provider)) : null,
    baseUrl: provider === 'ollama' ? settings.ollamaUrl : provider === 'openai' ? settings.openaiBaseUrl : ''
  }
}

export function registerAiIpc(db: Database): void {
  let running: AbortController | null = null

  ipcMain.handle(IPC.secretsSetAiKey, (_e, provider: unknown, key: unknown) =>
    setSecret(db, secretName(assertProvider(provider)), typeof key === 'string' ? key : null)
  )
  ipcMain.handle(IPC.secretsAiKeys, () => Object.fromEntries(AI_PROVIDER_IDS.map((p) => [p, hasSecret(db, secretName(p))])))

  ipcMain.handle(IPC.aiModels, (_e, provider: unknown) => listModels(clientConfig(db, assertProvider(provider)), AbortSignal.timeout(20_000)))

  ipcMain.handle(IPC.aiSource, (_e, ref: AiSourceRef) => resolveSource(db, ref))

  ipcMain.handle(IPC.aiGenerate, async (_e, input: AiGenerateRequest): Promise<AiGenerateResponse> => {
    const req = validateRequest(input)
    const provider = getSettings(db).aiProvider
    if (provider === 'none') throw new Error('Escolha um provedor de IA nas Configurações.')
    if (running) throw new Error('Já existe uma geração em andamento')
    const config = clientConfig(db, provider)
    const { text, truncated } = fitSource(req.text, AI_PROVIDERS[provider].maxSourceChars)
    const prompt = buildPrompt(req, text)

    const controller = new AbortController()
    running = controller
    try {
      const answer = await chat(config, { ...prompt, maxTokens: maxOutputTokens(req), json: true }, controller.signal)
      if (!answer.trim()) throw new Error('A IA devolveu uma resposta vazia')
      return { result: parseResult(req, answer), provider, model: config.model, truncated, usedChars: text.length }
    } finally {
      running = null
    }
  })

  ipcMain.handle(IPC.aiCancel, () => running?.abort())

  // Só abre páginas conhecidas: a interface não escolhe URLs.
  ipcMain.handle(IPC.aiOpenLink, (_e, link: unknown) => {
    if (typeof link !== 'string' || !(link in AI_LINKS)) throw new Error('Link inválido')
    return shell.openExternal(AI_LINKS[link as AiLink])
  })

  let login: AbortController | null = null
  ipcMain.handle(IPC.aiLoginOpenRouter, async () => {
    login?.abort()
    const controller = new AbortController()
    login = controller
    try {
      const key = await loginOpenRouter((url) => shell.openExternal(url), controller.signal)
      setSecret(db, secretName('openrouter'), key)
    } finally {
      if (login === controller) login = null
    }
  })
  ipcMain.handle(IPC.aiCancelLogin, () => login?.abort())

  ipcMain.handle(IPC.aiOllamaStatus, async () => ({ version: await ollamaVersion(getSettings(db).ollamaUrl) }))

  let pulling: AbortController | null = null
  const broadcast = (state: OllamaPullState) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.aiOllamaPullProgress, state)
  }
  ipcMain.handle(IPC.aiOllamaPull, async (_e, model: unknown) => {
    if (typeof model !== 'string' || !MODEL_NAME.test(model)) throw new Error('Nome de modelo inválido')
    if (pulling) throw new Error('Já existe um download em andamento')
    const controller = new AbortController()
    pulling = controller
    let last = 0
    try {
      await ollamaPull(
        getSettings(db).ollamaUrl,
        model,
        (p) => {
          // Limita a ~5 avisos por segundo; o Ollama manda muitas linhas.
          const now = Date.now()
          if (now - last < 200) return
          last = now
          broadcast({ model, status: p.status, fraction: p.fraction, done: false, error: null })
        },
        controller.signal
      )
      broadcast({ model, status: 'success', fraction: 1, done: true, error: null })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      broadcast({ model, status: 'error', fraction: null, done: true, error: message })
      throw error
    } finally {
      pulling = null
    }
  })
  ipcMain.handle(IPC.aiOllamaPullCancel, () => pulling?.abort())
}
