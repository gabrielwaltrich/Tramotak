import { AI_PROVIDERS, mergeSources, type AiModelInfo, type AiProvider, type AiWebSource } from '@shared/ai'

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1'
export const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta'
export const OPENAI_URL = 'https://api.openai.com/v1'
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1'
/** O OpenRouter usa estes cabeçalhos para identificar o app (opcionais). */
const OPENROUTER_HEADERS = { 'HTTP-Referer': 'https://github.com/gabrielwaltrich/Tramotak', 'X-Title': 'Tramotak' }
export const DEFAULT_OLLAMA_URL = 'http://localhost:11434'
/** Modelos locais geram devagar; os da nuvem respondem bem antes disso. */
const TIMEOUT_MS = 5 * 60_000
const OLLAMA_CONTEXT = 16_384

export interface AiClientConfig {
  provider: AiProvider
  model: string
  apiKey: string | null
  /** Ollama e servidores compatíveis com a OpenAI. */
  baseUrl: string
}

export interface ChatRequest {
  system: string
  /** Conversa em ordem, começando por uma pergunta. */
  messages: { role: 'user' | 'assistant'; content: string }[]
  maxTokens: number
  /** Pede JSON ao provedor quando ele tem esse modo. */
  json: boolean
  /** Deixa o modelo pesquisar na internet (Gemini, Claude e OpenRouter). */
  web?: boolean
  /** Guarda as instruções em cache entre perguntas (Claude; nos outros é automático). */
  cacheSystem?: boolean
}

export interface ChatResult {
  text: string
  sources: AiWebSource[]
}

type Fetch = typeof fetch

function friendlyError(provider: AiProvider, status: number, body: string): string {
  const name = AI_PROVIDERS[provider].label
  const detail = (() => {
    try {
      const data = JSON.parse(body) as { error?: { message?: string } | string; message?: string }
      return (typeof data.error === 'string' ? data.error : data.error?.message) ?? data.message ?? body
    } catch {
      return body
    }
  })().slice(0, 300)
  if (status === 401 || status === 403 || (status === 400 && /api.?key/i.test(detail))) return `${name} recusou a chave de API. Confira a chave nas Configurações.`
  if (status === 404) return `${name}: modelo ou endereço não encontrado (${detail}). Confira o modelo nas Configurações.`
  if (status === 429) return `${name}: limite de uso atingido. Tente de novo mais tarde.`
  if (status === 529 || status === 503) return `${name} está sobrecarregado no momento. Tente de novo em instantes.`
  return `${name} respondeu ${status}: ${detail}`
}

function trimUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** Faz o pedido e devolve a resposta já conferida (erros viram mensagens em português). */
async function send(
  config: AiClientConfig,
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  fetchImpl: Fetch,
  timeoutMs = TIMEOUT_MS
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  let response: Response
  try {
    response = await fetchImpl(url, { ...init, signal: combined })
  } catch (error) {
    if (signal?.aborted) throw new Error('Cancelado', { cause: error })
    if (timeout.aborted) throw new Error('A IA demorou demais para responder', { cause: error })
    const host = (() => {
      try {
        return new URL(url).host
      } catch {
        return url
      }
    })()
    const hint = config.provider === 'ollama' ? ' O Ollama está aberto?' : ''
    throw new Error(`Não foi possível conectar a ${host}.${hint}`, { cause: error })
  }
  if (!response.ok) throw new Error(friendlyError(config.provider, response.status, await response.text()))
  return response
}

async function request(config: AiClientConfig, url: string, init: RequestInit, signal: AbortSignal | undefined, fetchImpl: Fetch): Promise<unknown> {
  const body = await (await send(config, url, init, signal, fetchImpl)).text()
  try {
    return JSON.parse(body)
  } catch {
    throw new Error('Resposta inesperada do provedor de IA')
  }
}

function requireKey(config: AiClientConfig): string {
  if (!config.apiKey) throw new Error(`Cadastre a chave de API de ${AI_PROVIDERS[config.provider].label} nas Configurações.`)
  return config.apiKey
}

/** Monta o pedido de cada provedor (com ou sem streaming). */
function buildRequest(config: AiClientConfig, req: ChatRequest, stream: boolean): { url: string; init: RequestInit } {
  const json = { 'content-type': 'application/json' }
  const web = Boolean(req.web && AI_PROVIDERS[config.provider].web)
  switch (config.provider) {
    case 'anthropic':
      return {
        url: `${ANTHROPIC_URL}/messages`,
        init: {
          method: 'POST',
          headers: { ...json, 'x-api-key': requireKey(config), 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: config.model,
            max_tokens: req.maxTokens,
            system: req.cacheSystem ? [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }] : req.system,
            messages: req.messages,
            ...(web ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }] } : {}),
            ...(stream ? { stream: true } : {})
          })
        }
      }
    case 'gemini': {
      const model = encodeURIComponent(config.model.replace(/^models\//, ''))
      return {
        url: `${GEMINI_URL}/models/${model}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`,
        init: {
          method: 'POST',
          headers: { ...json, 'x-goog-api-key': requireKey(config) },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: req.system }] },
            contents: req.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
            // O modo JSON não combina com a pesquisa no Google; a leitura tolerante cuida da resposta.
            generationConfig: { maxOutputTokens: req.maxTokens, temperature: 0.4, ...(req.json && !web ? { responseMimeType: 'application/json' } : {}) },
            ...(web ? { tools: [{ google_search: {} }] } : {})
          })
        }
      }
    }
    case 'ollama':
      return {
        url: `${trimUrl(config.baseUrl || DEFAULT_OLLAMA_URL)}/api/chat`,
        init: {
          method: 'POST',
          headers: json,
          body: JSON.stringify({
            model: config.model,
            stream,
            ...(req.json ? { format: 'json' } : {}),
            options: { num_ctx: OLLAMA_CONTEXT, num_predict: req.maxTokens, temperature: 0.4 },
            messages: [{ role: 'system', content: req.system }, ...req.messages]
          })
        }
      }
    case 'openai':
    case 'openrouter': {
      const router = config.provider === 'openrouter'
      if (router) requireKey(config)
      const base = router ? OPENROUTER_URL : trimUrl(config.baseUrl || OPENAI_URL)
      const official = base.startsWith(OPENAI_URL)
      return {
        url: `${base}/chat/completions`,
        init: {
          method: 'POST',
          headers: { ...json, ...(router ? OPENROUTER_HEADERS : {}), ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
          body: JSON.stringify({
            model: config.model,
            messages: [{ role: 'system', content: req.system }, ...req.messages],
            // Nem todo servidor compatível aceita o modo JSON; só a API oficial recebe.
            ...(official && req.json ? { response_format: { type: 'json_object' } } : {}),
            ...(official ? { max_completion_tokens: req.maxTokens } : { max_tokens: req.maxTokens }),
            ...(router && web ? { plugins: [{ id: 'web', max_results: 5 }] } : {}),
            ...(stream ? { stream: true } : {})
          })
        }
      }
    }
  }
}

type AnthropicBlock = { type: string; text?: string; citations?: { type?: string; url?: string; title?: string }[] }
type GeminiChunk = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] } }[]
  promptFeedback?: { blockReason?: string }
}
type Annotation = { type?: string; url_citation?: { url?: string; title?: string } }

const citationSources = (list: AnthropicBlock['citations']): AiWebSource[] =>
  (list ?? []).filter((c) => c.url).map((c) => ({ url: c.url!, title: c.title ?? '' }))
const geminiSources = (chunk: GeminiChunk): AiWebSource[] =>
  (chunk.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []).filter((c) => c.web?.uri).map((c) => ({ url: c.web!.uri!, title: c.web!.title ?? '' }))
const annotationSources = (list: Annotation[] | undefined): AiWebSource[] =>
  (list ?? []).filter((a) => a.url_citation?.url).map((a) => ({ url: a.url_citation!.url!, title: a.url_citation!.title ?? '' }))
const geminiText = (chunk: GeminiChunk) => (chunk.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('')

/** Manda um pedido e devolve o texto da resposta (e as fontes, se pesquisou). */
export async function chat(config: AiClientConfig, req: ChatRequest, signal?: AbortSignal, fetchImpl: Fetch = fetch): Promise<ChatResult> {
  const { url, init } = buildRequest(config, req, false)
  const data = await request(config, url, init, signal, fetchImpl)
  switch (config.provider) {
    case 'anthropic': {
      const d = data as { content?: AnthropicBlock[]; stop_reason?: string }
      if (d.stop_reason === 'refusal') throw new Error('O modelo se recusou a responder a esse pedido')
      const blocks = (d.content ?? []).filter((c) => c.type === 'text')
      return { text: blocks.map((c) => c.text ?? '').join(''), sources: mergeSources(...blocks.map((b) => citationSources(b.citations))) }
    }
    case 'gemini': {
      const d = data as GeminiChunk
      if (d.promptFeedback?.blockReason) throw new Error(`O Gemini bloqueou o pedido (${d.promptFeedback.blockReason})`)
      return { text: geminiText(d), sources: mergeSources(geminiSources(d)) }
    }
    case 'ollama':
      return { text: (data as { message?: { content?: string } }).message?.content ?? '', sources: [] }
    case 'openai':
    case 'openrouter': {
      const message = (data as { choices?: { message?: { content?: string; refusal?: string; annotations?: Annotation[] } }[] }).choices?.[0]?.message
      if (message?.refusal) throw new Error('O modelo se recusou a responder a esse pedido')
      return { text: message?.content ?? '', sources: mergeSources(annotationSources(message?.annotations)) }
    }
  }
}

/** Lê o corpo linha a linha (SSE ou NDJSON). */
async function eachLine(body: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) onLine(line.replace(/\r$/, ''))
  }
  buffer += decoder.decode()
  if (buffer) onLine(buffer)
}

/** Como `chat`, mas entrega o texto aos pedaços enquanto o modelo escreve. */
export async function chatStream(
  config: AiClientConfig,
  req: ChatRequest,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  fetchImpl: Fetch = fetch
): Promise<ChatResult> {
  const { url, init } = buildRequest(config, req, true)
  const response = await send(config, url, init, signal, fetchImpl, 2 * TIMEOUT_MS)
  if (!response.body) throw new Error('Resposta vazia do provedor de IA')
  let text = ''
  const sources: AiWebSource[][] = []
  const emit = (piece: string | undefined) => {
    if (!piece) return
    text += piece
    onDelta(piece)
  }
  const handle = (payload: string) => {
    let data: Record<string, unknown>
    try {
      data = JSON.parse(payload)
    } catch {
      return
    }
    switch (config.provider) {
      case 'anthropic': {
        if (data.type === 'error') throw new Error(`Claude: ${(data.error as { message?: string })?.message ?? 'erro na resposta'}`)
        const delta = data.delta as { type?: string; text?: string; citation?: { url?: string; title?: string }; stop_reason?: string } | undefined
        if (data.type === 'content_block_delta' && delta?.type === 'text_delta') emit(delta.text)
        if (data.type === 'content_block_delta' && delta?.type === 'citations_delta' && delta.citation) sources.push(citationSources([delta.citation]))
        if (data.type === 'message_delta' && delta?.stop_reason === 'refusal') throw new Error('O modelo se recusou a responder a esse pedido')
        break
      }
      case 'gemini': {
        const chunk = data as GeminiChunk
        if (chunk.promptFeedback?.blockReason) throw new Error(`O Gemini bloqueou o pedido (${chunk.promptFeedback.blockReason})`)
        emit(geminiText(chunk))
        sources.push(geminiSources(chunk))
        break
      }
      case 'ollama':
        if (typeof data.error === 'string') throw new Error(`Ollama: ${data.error}`)
        emit((data.message as { content?: string } | undefined)?.content)
        break
      case 'openai':
      case 'openrouter': {
        if (data.error) throw new Error(`${AI_PROVIDERS[config.provider].label}: ${(data.error as { message?: string }).message ?? 'erro na resposta'}`)
        const choice = (data.choices as { delta?: { content?: string; annotations?: Annotation[] }; message?: { annotations?: Annotation[] } }[] | undefined)?.[0]
        emit(choice?.delta?.content ?? undefined)
        sources.push(annotationSources(choice?.delta?.annotations ?? choice?.message?.annotations))
        break
      }
    }
  }
  try {
    await eachLine(response.body, (line) => {
      if (config.provider === 'ollama') {
        if (line.trim()) handle(line)
        return
      }
      if (!line.startsWith('data:')) return
      const payload = line.slice(5).trim()
      if (payload && payload !== '[DONE]') handle(payload)
    })
  } catch (error) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelado', { cause: error }), { partial: text })
    throw error
  }
  return { text, sources: mergeSources(...sources) }
}

/** Lista os modelos da conta/servidor; serve também para testar a conexão e a chave. */
export async function listModels(config: Omit<AiClientConfig, 'model'>, signal?: AbortSignal, fetchImpl: Fetch = fetch): Promise<AiModelInfo[]> {
  const cfg = { ...config, model: '' }
  let models: AiModelInfo[]
  const paid = (id: string): AiModelInfo => ({ id, free: false })
  switch (config.provider) {
    case 'anthropic': {
      const data = (await request(
        cfg,
        `${ANTHROPIC_URL}/models?limit=100`,
        { headers: { 'x-api-key': requireKey(cfg), 'anthropic-version': '2023-06-01' } },
        signal,
        fetchImpl
      )) as { data?: { id: string }[] }
      models = (data.data ?? []).map((m) => paid(m.id))
      break
    }
    case 'gemini': {
      const data = (await request(cfg, `${GEMINI_URL}/models?pageSize=200`, { headers: { 'x-goog-api-key': requireKey(cfg) } }, signal, fetchImpl)) as {
        models?: { name: string; supportedGenerationMethods?: string[] }[]
      }
      models = (data.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent') && /gemini/i.test(m.name) && !/tts|image|embedding|live|audio/i.test(m.name))
        .map((m) => paid(m.name.replace(/^models\//, '')))
      break
    }
    case 'ollama': {
      const data = (await request(cfg, `${trimUrl(config.baseUrl || DEFAULT_OLLAMA_URL)}/api/tags`, {}, signal, fetchImpl)) as { models?: { name: string }[] }
      models = (data.models ?? []).map((m) => ({ id: m.name, free: true }))
      break
    }
    case 'openrouter': {
      // A lista é pública; a chave é conferida à parte para o teste de conexão valer.
      const headers = { Authorization: `Bearer ${requireKey(cfg)}`, ...OPENROUTER_HEADERS }
      await request(cfg, `${OPENROUTER_URL}/key`, { headers }, signal, fetchImpl)
      const data = (await request(cfg, `${OPENROUTER_URL}/models`, { headers }, signal, fetchImpl)) as {
        data?: { id: string; pricing?: { prompt?: string; completion?: string }; architecture?: { output_modalities?: string[] } }[]
      }
      models = (data.data ?? [])
        .filter((m) => !m.architecture?.output_modalities || m.architecture.output_modalities.includes('text'))
        .map((m) => ({ id: m.id, free: m.id.endsWith(':free') || m.id === 'openrouter/free' || (Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0) }))
      break
    }
    case 'openai': {
      const data = (await request(
        cfg,
        `${trimUrl(config.baseUrl || OPENAI_URL)}/models`,
        { headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {} },
        signal,
        fetchImpl
      )) as { data?: { id: string }[] }
      models = (data.data ?? []).map((m) => paid(m.id))
      break
    }
  }
  const unique = new Map(models.map((m) => [m.id, m]))
  return [...unique.values()].sort((a, b) => a.id.localeCompare(b.id))
}

// ── Ollama ──────────────────────────────────────────────────────────────────

/** Versão do Ollama em execução, ou `null` se não respondeu. */
export async function ollamaVersion(baseUrl: string, fetchImpl: Fetch = fetch): Promise<string | null> {
  try {
    const response = await fetchImpl(`${trimUrl(baseUrl || DEFAULT_OLLAMA_URL)}/api/version`, { signal: AbortSignal.timeout(3000) })
    if (!response.ok) return null
    return ((await response.json()) as { version?: string }).version ?? '?'
  } catch {
    return null
  }
}

export interface PullProgress {
  status: string
  /** 0 a 1, quando o Ollama informa o tamanho. */
  fraction: number | null
}

/** Baixa um modelo pelo Ollama, lendo o progresso linha a linha (NDJSON). */
export async function ollamaPull(
  baseUrl: string,
  model: string,
  onProgress: (p: PullProgress) => void,
  signal?: AbortSignal,
  fetchImpl: Fetch = fetch
): Promise<void> {
  let response: Response
  try {
    response = await fetchImpl(`${trimUrl(baseUrl || DEFAULT_OLLAMA_URL)}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
      signal
    })
  } catch (error) {
    if (signal?.aborted) throw new Error('Cancelado', { cause: error })
    throw new Error('Não foi possível conectar ao Ollama. Ele está aberto?', { cause: error })
  }
  if (!response.ok || !response.body) throw new Error(friendlyError('ollama', response.status, await response.text()))
  const decoder = new TextDecoder()
  let buffer = ''
  const handle = (line: string) => {
    if (!line.trim()) return
    const data = JSON.parse(line) as { status?: string; total?: number; completed?: number; error?: string }
    if (data.error) throw new Error(`Ollama: ${data.error}`)
    onProgress({ status: data.status ?? '', fraction: data.total ? Math.min(1, (data.completed ?? 0) / data.total) : null })
  }
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      lines.forEach(handle)
    }
    handle(buffer)
  } catch (error) {
    if (signal?.aborted) throw new Error('Cancelado', { cause: error })
    throw error
  }
}
