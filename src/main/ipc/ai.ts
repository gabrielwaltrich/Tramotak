import { BrowserWindow, ipcMain, shell } from 'electron'
import {
  AI_LINKS,
  AI_PROVIDER_IDS,
  AI_PROVIDERS,
  MODEL_NAME,
  MAX_CHAT_QUESTION,
  extractJson,
  buildChatSystem,
  chatHistory,
  buildPrompt,
  fitSource,
  maxOutputTokens,
  parseResult,
  validateRequest,
  type AiGenerateRequest,
  type AiLink,
  type AiGenerateResponse,
  type AiProvider,
  type AiSourceRef,
  type ChatMessage,
  type ChatSendRequest
} from '@shared/ai'
import { IPC, type OllamaPullState } from '@shared/ipc'
import { buildTitleRulesPrompt, normalizeTitleRules, sampleNames, type TitleRules } from '@shared/titleRules'
import type { Database } from '../db/database'
import { getSettings } from '../db/settings'
import { getSecret, hasSecret, setSecret } from '../secrets'
import { chat, chatStream, listModels, ollamaPull, ollamaVersion, type AiClientConfig } from '../ai/client'
import { appendChat, clearChat, getChat } from '../db/chats'
import { loginOpenRouter } from '../ai/openrouterAuth'
import { chatMaterial, resolveSource, reviewMaterial } from '../ai/source'
import { getReview, reviewSummary, saveReviewAnswers, saveReviewQuestions } from '../db/reviews'
import { REVIEW_MIN_CHARS, reviewRequest, type LessonReview, type ReviewStatus } from '@shared/review'

function assertId(id: unknown): number {
  if (!Number.isInteger(id)) throw new Error('Identificador inválido')
  return id as number
}

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
    const provider = getSettings(db).aiProvider
    if (provider === 'none') throw new Error('Escolha um provedor de IA nas Configurações.')
    const valid = validateRequest(input)
    // Sem pesquisa no provedor, as regras do prompt são as de "só o material".
    const req = { ...valid, webSearch: valid.webSearch && AI_PROVIDERS[provider].web !== null }
    if (running) throw new Error('Já existe uma geração em andamento')
    const config = clientConfig(db, provider)
    const { text, truncated } = fitSource(req.text, AI_PROVIDERS[provider].maxSourceChars)
    const prompt = buildPrompt(req, text)

    const controller = new AbortController()
    running = controller
    try {
      const answer = await chat(
        config,
        { system: prompt.system, messages: [{ role: 'user', content: prompt.user }], maxTokens: maxOutputTokens(req), json: true, web: req.webSearch },
        controller.signal
      )
      if (!answer.text.trim()) throw new Error('A IA devolveu uma resposta vazia')
      return { result: parseResult(req, answer.text), provider, model: config.model, truncated, usedChars: text.length, sources: answer.sources }
    } finally {
      running = null
    }
  })

  ipcMain.handle(IPC.aiCancel, () => running?.abort())

  // Regras de nomes: a IA vê exemplos dos nomes de arquivo e escolhe valores para as regras fixas.
  ipcMain.handle(IPC.aiSuggestTitleRules, async (_e, courseId: unknown, request: unknown): Promise<TitleRules> => {
    const provider = getSettings(db).aiProvider
    if (provider === 'none') throw new Error('Escolha um provedor de IA nas Configurações.')
    const names = (db.prepare('SELECT rel_path AS p FROM lessons WHERE course_id = ? ORDER BY id').all(assertId(courseId)) as { p: string }[]).map((r) => {
      const name = r.p.split('/').pop() ?? r.p
      return name.replace(/\.[^.]+$/, '')
    })
    if (!names.length) throw new Error('Este curso não tem aulas')
    const prompt = buildTitleRulesPrompt(sampleNames(names, 20), String(request ?? '').slice(0, 1000))
    const answer = await chat(
      clientConfig(db, provider),
      { system: prompt.system, messages: [{ role: 'user', content: prompt.user }], maxTokens: 1500, json: true },
      AbortSignal.timeout(120_000)
    )
    return normalizeTitleRules({ ...(extractJson(answer.text) as object), enabled: true })
  })

  // ── Revisão pós-aula ──
  let reviewing: AbortController | null = null

  ipcMain.handle(IPC.reviewStatus, async (_e, lessonId: unknown): Promise<ReviewStatus> => {
    const id = assertId(lessonId)
    const settings = getSettings(db)
    const material = await reviewMaterial(db, id)
    const enough = material.text.trim().length >= REVIEW_MIN_CHARS
    return {
      enabled: settings.review.enabled,
      count: settings.review.count,
      ai: settings.aiProvider !== 'none',
      material: enough ? 'ready' : material.kind === 'video' && settings.transcriptionProvider !== 'none' ? 'transcribe' : 'none',
      saved: reviewSummary(db, id)
    }
  })

  ipcMain.handle(IPC.reviewGet, (_e, lessonId: unknown) => getReview(db, assertId(lessonId)))

  // Perguntas novas para a aula (substituem as anteriores). Só a fala/legenda/texto da aula vai para a IA.
  ipcMain.handle(IPC.reviewGenerate, async (_e, lessonId: unknown): Promise<LessonReview> => {
    const id = assertId(lessonId)
    const settings = getSettings(db)
    const provider = settings.aiProvider
    if (provider === 'none') throw new Error('Escolha um provedor de IA nas Configurações.')
    if (reviewing) throw new Error('A revisão já está sendo preparada')
    const material = await reviewMaterial(db, id)
    if (material.text.trim().length < REVIEW_MIN_CHARS) throw new Error('Esta aula ainda não tem transcrição, legenda ou texto suficiente para a revisão.')
    const config = clientConfig(db, provider)
    const { text } = fitSource(material.text, AI_PROVIDERS[provider].maxSourceChars)
    const req = reviewRequest(text, settings.review.count)
    const prompt = buildPrompt(req, text)

    const controller = new AbortController()
    reviewing = controller
    try {
      const answer = await chat(
        config,
        { system: prompt.system, messages: [{ role: 'user', content: prompt.user }], maxTokens: maxOutputTokens(req), json: true },
        controller.signal
      )
      if (!answer.text.trim()) throw new Error('A IA devolveu uma resposta vazia')
      const result = parseResult(req, answer.text)
      if (result.task !== 'questions') throw new Error('A IA não devolveu perguntas')
      return saveReviewQuestions(db, id, result.questions.slice(0, req.count))
    } finally {
      reviewing = null
    }
  })

  ipcMain.handle(IPC.reviewAnswer, (_e, lessonId: unknown, answers: unknown) => saveReviewAnswers(db, assertId(lessonId), answers))
  ipcMain.handle(IPC.reviewCancel, () => reviewing?.abort())

  // ── Conversa sobre a aula ──
  let chatting: AbortController | null = null

  ipcMain.handle(IPC.aiChatGet, async (_e, lessonId: unknown, includeNotes: unknown) => {
    const id = assertId(lessonId)
    return { messages: getChat(db, id), material: (await chatMaterial(db, id, includeNotes === true)).info }
  })

  ipcMain.handle(IPC.aiChatClear, (_e, lessonId: unknown) => clearChat(db, assertId(lessonId)))
  ipcMain.handle(IPC.aiChatCancel, () => chatting?.abort())

  ipcMain.handle(IPC.aiChatSend, async (event, input: ChatSendRequest): Promise<ChatMessage> => {
    const lessonId = assertId(input?.lessonId)
    const question = String(input?.text ?? '').trim().slice(0, MAX_CHAT_QUESTION)
    if (!question) throw new Error('Escreva uma pergunta')
    const provider = getSettings(db).aiProvider
    if (provider === 'none') throw new Error('Escolha um provedor de IA nas Configurações.')
    if (chatting) throw new Error('Espere a resposta anterior terminar')
    const info = AI_PROVIDERS[provider]
    const web = input.webSearch === true && info.web !== null

    const material = await chatMaterial(db, lessonId, input.includeNotes === true)
    if (!material.text.trim()) throw new Error('Esta aula ainda não tem transcrição, legenda nem texto para a IA ler.')
    const { text } = fitSource(material.text, info.maxSourceChars)
    const videoSec = typeof input.videoSec === 'number' && Number.isFinite(input.videoSec) ? Math.max(0, input.videoSec) : null
    const page = material.info.kind === 'pdf' && Number.isInteger(input.page) && (input.page as number) >= 1 ? (input.page as number) : null
    const asked: ChatMessage = { role: 'user', content: question, at: Math.floor(Date.now() / 1000), videoSec, ...(page !== null ? { page } : {}) }
    const history = chatHistory([...getChat(db, lessonId), asked])

    const controller = new AbortController()
    chatting = controller
    const send = (piece: string) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.aiChatDelta, { lessonId, text: piece })
    }
    try {
      const result = await chatStream(
        clientConfig(db, provider),
        { system: buildChatSystem(text, { web, hasNotes: input.includeNotes === true && material.info.notes > 0, pdf: material.info.kind === 'pdf' }), messages: history, maxTokens: 4000, json: false, web, cacheSystem: true },
        send,
        controller.signal
      )
      const answer: ChatMessage = { role: 'assistant', content: result.text.trim() || '(sem resposta)', at: Math.floor(Date.now() / 1000), ...(result.sources.length ? { sources: result.sources } : {}) }
      appendChat(db, lessonId, [asked, answer])
      return answer
    } catch (error) {
      // Interrompida: guarda o que já tinha chegado.
      const partial = (error as { partial?: string }).partial
      if (controller.signal.aborted) {
        const answer: ChatMessage = { role: 'assistant', content: partial?.trim() || '', at: Math.floor(Date.now() / 1000), interrupted: true }
        appendChat(db, lessonId, [asked, answer])
        return answer
      }
      throw error
    } finally {
      chatting = null
    }
  })

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
