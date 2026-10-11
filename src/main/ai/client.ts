import { AI_PROVIDERS, type AiModelInfo, type AiProvider } from '@shared/ai'

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
  user: string
  maxTokens: number
  /** Pede JSON ao provedor quando ele tem esse modo. */
  json: boolean
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

async function request(
  config: AiClientConfig,
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  fetchImpl: Fetch
): Promise<unknown> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
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
  const body = await response.text()
  if (!response.ok) throw new Error(friendlyError(config.provider, response.status, body))
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

/** Manda um pedido e devolve o texto da resposta. */
export async function chat(config: AiClientConfig, req: ChatRequest, signal?: AbortSignal, fetchImpl: Fetch = fetch): Promise<string> {
  const json = { 'content-type': 'application/json' }
  switch (config.provider) {
    case 'anthropic': {
      const data = (await request(
        config,
        `${ANTHROPIC_URL}/messages`,
        {
          method: 'POST',
          headers: { ...json, 'x-api-key': requireKey(config), 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: config.model,
            max_tokens: req.maxTokens,
            system: req.system,
            messages: [{ role: 'user', content: req.user }]
          })
        },
        signal,
        fetchImpl
      )) as { content?: { type: string; text?: string }[]; stop_reason?: string }
      if (data.stop_reason === 'refusal') throw new Error('O modelo se recusou a responder a esse pedido')
      return (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('')
    }
    case 'gemini': {
      const data = (await request(
        config,
        `${GEMINI_URL}/models/${encodeURIComponent(config.model.replace(/^models\//, ''))}:generateContent`,
        {
          method: 'POST',
          headers: { ...json, 'x-goog-api-key': requireKey(config) },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: req.system }] },
            contents: [{ role: 'user', parts: [{ text: req.user }] }],
            generationConfig: { maxOutputTokens: req.maxTokens, temperature: 0.4, ...(req.json ? { responseMimeType: 'application/json' } : {}) }
          })
        },
        signal,
        fetchImpl
      )) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } }
      if (data.promptFeedback?.blockReason) throw new Error(`O Gemini bloqueou o pedido (${data.promptFeedback.blockReason})`)
      return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    }
    case 'ollama': {
      const data = (await request(
        config,
        `${trimUrl(config.baseUrl || DEFAULT_OLLAMA_URL)}/api/chat`,
        {
          method: 'POST',
          headers: json,
          body: JSON.stringify({
            model: config.model,
            stream: false,
            ...(req.json ? { format: 'json' } : {}),
            options: { num_ctx: OLLAMA_CONTEXT, num_predict: req.maxTokens, temperature: 0.4 },
            messages: [
              { role: 'system', content: req.system },
              { role: 'user', content: req.user }
            ]
          })
        },
        signal,
        fetchImpl
      )) as { message?: { content?: string } }
      return data.message?.content ?? ''
    }
    case 'openai':
    case 'openrouter': {
      const router = config.provider === 'openrouter'
      if (router) requireKey(config)
      const base = router ? OPENROUTER_URL : trimUrl(config.baseUrl || OPENAI_URL)
      const official = base.startsWith(OPENAI_URL)
      const data = (await request(
        config,
        `${base}/chat/completions`,
        {
          method: 'POST',
          headers: { ...json, ...(router ? OPENROUTER_HEADERS : {}), ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: 'system', content: req.system },
              { role: 'user', content: req.user }
            ],
            // Nem todo servidor compatível aceita o modo JSON; só a API oficial recebe.
            ...(official && req.json ? { response_format: { type: 'json_object' } } : {}),
            ...(official ? { max_completion_tokens: req.maxTokens } : { max_tokens: req.maxTokens })
          })
        },
        signal,
        fetchImpl
      )) as { choices?: { message?: { content?: string; refusal?: string } }[] }
      const message = data.choices?.[0]?.message
      if (message?.refusal) throw new Error('O modelo se recusou a responder a esse pedido')
      return message?.content ?? ''
    }
  }
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
