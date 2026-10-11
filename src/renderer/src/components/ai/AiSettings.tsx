import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Download, ExternalLink, Info, KeyRound, Loader2, LogIn, RefreshCw, X } from 'lucide-react'
import type { AppSettings, OllamaPullState } from '@shared/ipc'
import { AI_PROVIDER_IDS, AI_PROVIDERS, LIGHT_MODELS, type AiLink, type AiProvider } from '@shared/ai'
import { errorMessage, queryKeys } from '../../lib/api'
import { Button } from '../Button'
import { Label, TextInput } from '../Field'
import { useToast } from '../Toast'

export const aiKeysQuery = { queryKey: ['ai-keys'], queryFn: () => window.api.secrets.aiKeys() }

/** Provedor de IA configurado o bastante para gerar (chave salva quando ela é obrigatória). */
export function aiReady(settings: AppSettings | undefined, keys: Record<AiProvider, boolean> | undefined): boolean {
  if (!settings || settings.aiProvider === 'none') return false
  const p = settings.aiProvider
  return p === 'ollama' || p === 'openai' || Boolean(keys?.[p])
}

const BADGE_STYLE: Record<string, string> = {
  Grátis: 'bg-success/15 text-success',
  Login: 'bg-accent-soft text-accent',
  Local: 'bg-success/15 text-success',
  Pago: 'bg-surface-2 text-muted',
  Avançado: 'bg-surface-2 text-muted'
}

function useSaveSettings() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (patch: Partial<AppSettings>) => window.api.settings.update(patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
    onError: (error) => toast(errorMessage(error), 'error')
  })
}

function openLink(link: AiLink, toast: ReturnType<typeof useToast>) {
  window.api.ai.openLink(link).catch((e) => toast(errorMessage(e), 'error'))
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2 rounded-lg border border-border bg-bg/50 p-3 text-xs text-muted">
      <Info size={14} className="mt-0.5 shrink-0 text-accent" />
      <span>{children}</span>
    </p>
  )
}

function KeyField({ provider, saved, label = 'Chave de API' }: { provider: AiProvider; saved: boolean; label?: string }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [key, setKey] = useState('')
  const info = AI_PROVIDERS[provider]
  const saveKey = useMutation({
    mutationFn: (value: string | null) => window.api.secrets.setAiKey(provider, value),
    onSuccess: async (_r, value) => {
      setKey('')
      await queryClient.invalidateQueries({ queryKey: aiKeysQuery.queryKey })
      toast(value ? 'Chave salva' : 'Chave removida')
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })
  if (saved) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <KeyRound size={14} className="text-success" /> Chave salva (cifrada neste computador)
        <Button variant="ghost" className="ml-auto h-8" onClick={() => saveKey.mutate(null)}>
          Remover
        </Button>
      </div>
    )
  }
  return (
    <div>
      <Label>{label}</Label>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (key.trim()) saveKey.mutate(key)
        }}
      >
        <TextInput type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={info.keyPlaceholder} aria-label={`Chave de API de ${info.label}`} autoComplete="off" />
        <Button type="submit" disabled={!key.trim() || saveKey.isPending} className="shrink-0 whitespace-nowrap">
          Salvar chave
        </Button>
      </form>
    </div>
  )
}

/** Escolha do modelo, com a lista da conta (que também testa a chave/conexão). */
function ModelPicker({ provider, settings, ready, freeFilter = false }: { provider: AiProvider; settings: AppSettings; ready: boolean; freeFilter?: boolean }) {
  const save = useSaveSettings()
  const toast = useToast()
  const current = settings.aiModels[provider]
  const [model, setModel] = useState(current)
  const [freeOnly, setFreeOnly] = useState(freeFilter)
  const models = useQuery({ queryKey: ['ai-models', provider, ready], queryFn: () => window.api.ai.models(provider), enabled: ready, retry: false, staleTime: 5 * 60_000 })
  const listed = (models.data ?? []).filter((m) => !freeOnly || m.free)
  const info = AI_PROVIDERS[provider]
  const missing = models.isSuccess && models.data.length > 0 && !models.data.some((m) => m.id === current)

  const choose = (id: string) => {
    setModel(id)
    save.mutate({ aiModels: { ...settings.aiModels, [provider]: id } }, { onSuccess: () => toast(`Modelo: ${id}`) })
  }

  return (
    <div>
      <Label htmlFor="ai-model">Modelo</Label>
      <div className="flex gap-2">
        <TextInput id="ai-model" list="ai-model-options" value={model} onChange={(e) => setModel(e.target.value)} className="font-mono text-xs" />
        <datalist id="ai-model-options">
          {[...new Set([...info.suggestions, ...listed.map((m) => m.id)])].map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <Button variant="ghost" onClick={() => choose(model.trim())} disabled={!model.trim() || model === current}>
          Salvar
        </Button>
      </div>
      {ready && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted">
          <button type="button" onClick={() => models.refetch()} disabled={models.isFetching} className="inline-flex items-center gap-1 text-accent hover:underline disabled:opacity-50">
            {models.isFetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Testar conexão e listar modelos
          </button>
          {models.isSuccess && (
            <span className="inline-flex items-center gap-1 text-success">
              <CheckCircle2 size={12} /> Conectado · {models.data.length} {models.data.length === 1 ? 'modelo' : 'modelos'}
            </span>
          )}
          {freeFilter && (
            <label className="ml-auto flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} className="size-3.5 accent-[var(--accent)]" /> Só gratuitos
            </label>
          )}
        </div>
      )}
      {models.error && <p className="mt-2 text-xs text-red-500">{errorMessage(models.error)}</p>}
      {missing && <p className="mt-2 text-xs text-warning">O modelo “{current}” não aparece na sua conta. Escolha um da lista.</p>}
      {listed.length > 0 && (
        <div className="mt-2 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
          {listed.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => choose(m.id)}
              className={`rounded border px-2 py-0.5 font-mono text-[11px] ${m.id === current ? 'border-accent bg-accent-soft text-accent' : 'border-border text-muted hover:text-text'}`}
            >
              {m.id}
              {freeFilter && m.free && !freeOnly && <span className="ml-1 text-success">grátis</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Painéis por provedor ────────────────────────────────────────────────────

function GeminiPanel({ settings, hasKey }: { settings: AppSettings; hasKey: boolean }) {
  const toast = useToast()
  return (
    <div className="space-y-4">
      {!hasKey && (
        <ol className="space-y-2 text-sm">
          <li>
            <span className="text-muted">1.</span> Abra o Google AI Studio e entre com a sua conta Google pessoal.{' '}
            <button type="button" onClick={() => openLink('geminiKey', toast)} className="inline-flex items-center gap-1 text-accent hover:underline">
              Abrir AI Studio <ExternalLink size={12} />
            </button>
          </li>
          <li>
            <span className="text-muted">2.</span> Clique em <b>Criar chave de API</b> (Create API key). Não pede cartão.
          </li>
          <li>
            <span className="text-muted">3.</span> Copie a chave e cole aqui:
          </li>
        </ol>
      )}
      <KeyField provider="gemini" saved={hasKey} />
      <ModelPicker provider="gemini" settings={settings} ready={hasKey} />
      <Note>
        O plano gratuito do Gemini tem limite de pedidos por minuto e por dia (de sobra para estudar) e, nele, o Google pode usar o conteúdo enviado para melhorar os produtos
        dele. Evite mandar material sigiloso; para mais privacidade, use um modelo local.
      </Note>
    </div>
  )
}

function OpenRouterPanel({ settings, hasKey }: { settings: AppSettings; hasKey: boolean }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [manual, setManual] = useState(false)
  const login = useMutation({
    mutationFn: () => window.api.ai.loginOpenRouter(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: aiKeysQuery.queryKey })
      toast('Conta do OpenRouter conectada')
    },
    onError: (error) => errorMessage(error) !== 'Cancelado' && toast(errorMessage(error), 'error')
  })
  const logout = useMutation({
    mutationFn: () => window.api.secrets.setAiKey('openrouter', null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: aiKeysQuery.queryKey })
  })
  return (
    <div className="space-y-4">
      {hasKey ? (
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 size={14} className="text-success" /> Conta do OpenRouter conectada
          <Button variant="ghost" className="ml-auto h-8" onClick={() => logout.mutate()}>
            Desconectar
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            {login.isPending ? (
              <>
                <Button disabled>
                  <Loader2 size={16} className="animate-spin" /> Aguardando o login no navegador…
                </Button>
                <Button variant="ghost" onClick={() => window.api.ai.cancelLogin()}>
                  <X size={16} /> Cancelar
                </Button>
              </>
            ) : (
              <Button onClick={() => login.mutate()}>
                <LogIn size={16} /> Entrar com OpenRouter
              </Button>
            )}
            <button type="button" onClick={() => setManual((v) => !v)} className="text-xs text-muted hover:text-text">
              ou colar uma chave
            </button>
          </div>
          <p className="text-xs text-muted">Abre o navegador para você entrar (ou criar uma conta grátis com Google ou GitHub) e autorizar o Tramotak.</p>
          {manual && <KeyField provider="openrouter" saved={false} />}
        </div>
      )}
      <ModelPicker provider="openrouter" settings={settings} ready={hasKey} freeFilter />
      <Note>
        <b>openrouter/free</b> escolhe sozinho um modelo gratuito disponível. Modelos gratuitos têm limite diário de pedidos e alguns provedores deles podem guardar o que
        é enviado. Modelos pagos (Claude, GPT, Gemini Pro…) usam créditos da sua conta do OpenRouter.
      </Note>
    </div>
  )
}

function OllamaPanel({ settings }: { settings: AppSettings }) {
  const toast = useToast()
  const save = useSaveSettings()
  const queryClient = useQueryClient()
  const [url, setUrl] = useState(settings.ollamaUrl)
  const [pull, setPull] = useState<OllamaPullState | null>(null)
  const status = useQuery({ queryKey: ['ollama-status', settings.ollamaUrl], queryFn: () => window.api.ai.ollamaStatus(), staleTime: 0 })
  const running = Boolean(status.data?.version)
  const installed = useQuery({ queryKey: ['ai-models', 'ollama', running], queryFn: () => window.api.ai.models('ollama'), enabled: running, retry: false })
  const names = new Set((installed.data ?? []).map((m) => m.id))
  const isInstalled = (name: string) => names.has(name) || names.has(`${name}:latest`)

  useEffect(() => window.api.ai.onPullProgress(setPull), [])

  const download = useMutation({
    mutationFn: (model: string) => window.api.ai.ollamaPull(model),
    onSuccess: async (_r, model) => {
      await queryClient.invalidateQueries({ queryKey: ['ai-models', 'ollama'] })
      save.mutate({ aiModels: { ...settings.aiModels, ollama: model } })
      toast(`${model} instalado e escolhido`)
    },
    onError: (error) => errorMessage(error) !== 'Cancelado' && toast(errorMessage(error), 'error')
  })
  const use = (model: string) => save.mutate({ aiModels: { ...settings.aiModels, ollama: model } }, { onSuccess: () => toast(`Modelo: ${model}`) })
  const current = settings.aiModels.ollama

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {status.isPending ? (
          <Loader2 size={14} className="animate-spin text-muted" />
        ) : running ? (
          <span className="inline-flex items-center gap-1.5 text-success">
            <CheckCircle2 size={14} /> Ollama {status.data?.version} encontrado
          </span>
        ) : (
          <span className="text-warning">Ollama não encontrado neste endereço.</span>
        )}
        {!running && !status.isPending && (
          <button type="button" onClick={() => openLink('ollamaDownload', toast)} className="inline-flex items-center gap-1 text-accent hover:underline">
            Baixar o Ollama (grátis) <ExternalLink size={12} />
          </button>
        )}
        <button type="button" onClick={() => status.refetch()} className="ml-auto inline-flex items-center gap-1 text-xs text-muted hover:text-text">
          <RefreshCw size={12} /> Verificar de novo
        </button>
      </div>

      <div>
        <Label htmlFor="ai-url">Endereço do Ollama</Label>
        <div className="flex gap-2">
          <TextInput id="ai-url" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button variant="ghost" onClick={() => save.mutate({ ollamaUrl: url })} disabled={url === settings.ollamaUrl}>
            Salvar
          </Button>
        </div>
      </div>

      <div>
        <Label>Modelos leves recomendados</Label>
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {LIGHT_MODELS.map((m) => {
            const here = isInstalled(m.name)
            const active = current === m.name || current === `${m.name}:latest`
            const progress = pull && pull.model === m.name && !pull.done ? pull : null
            return (
              <li key={m.name} className="flex items-center gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p>
                    <span className="font-mono text-xs">{m.name}</span> <span className="text-xs text-muted">· {m.size}</span>
                  </p>
                  <p className="text-xs text-muted">{m.note}</p>
                  {progress && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded bg-surface-2">
                        <div className="h-full bg-accent transition-all" style={{ width: `${Math.round((progress.fraction ?? 0) * 100)}%` }} />
                      </div>
                      <span className="w-10 text-right text-[11px] text-muted tabular-nums">{progress.fraction !== null ? `${Math.round(progress.fraction * 100)}%` : '…'}</span>
                    </div>
                  )}
                </div>
                {active && here ? (
                  <span className="text-xs text-success">Em uso</span>
                ) : here ? (
                  <Button variant="ghost" className="h-8" onClick={() => use(m.name)}>
                    Usar
                  </Button>
                ) : progress ? (
                  <Button variant="ghost" className="h-8" onClick={() => window.api.ai.ollamaPullCancel()}>
                    <X size={14} /> Cancelar
                  </Button>
                ) : (
                  <Button variant="ghost" className="h-8" disabled={!running || download.isPending} onClick={() => download.mutate(m.name)}>
                    <Download size={14} /> Instalar
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
        <p className="mt-2 text-xs text-muted">Rodam no seu computador, sem internet e sem enviar nada. Precisam de uns 8 GB de RAM; são mais lentos e menos precisos que os da nuvem.</p>
      </div>

      {running && <ModelPicker key={current} provider="ollama" settings={settings} ready />}
    </div>
  )
}

function AnthropicPanel({ settings, hasKey }: { settings: AppSettings; hasKey: boolean }) {
  const toast = useToast()
  return (
    <div className="space-y-4">
      <Note>
        A assinatura pessoal do Claude (Free, Pro ou Max, o login do claude.ai) não pode ser usada em outros apps: a Anthropic só permite esse login no Claude.ai e no
        Claude Code e bloqueia o resto. Para usar o Claude aqui: crie uma chave de API no Claude Console (pago por uso, separado da assinatura) ou entre no{' '}
        <b>OpenRouter</b> e escolha um modelo Claude.
      </Note>
      {!hasKey && (
        <button type="button" onClick={() => openLink('anthropicKey', toast)} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
          Criar chave no Claude Console <ExternalLink size={12} />
        </button>
      )}
      <KeyField provider="anthropic" saved={hasKey} />
      <ModelPicker provider="anthropic" settings={settings} ready={hasKey} />
    </div>
  )
}

function OpenAiPanel({ settings, hasKey }: { settings: AppSettings; hasKey: boolean }) {
  const save = useSaveSettings()
  const [url, setUrl] = useState(settings.openaiBaseUrl)
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">Qualquer servidor que fale a API da OpenAI: a própria OpenAI, LM Studio, vLLM, LocalAI…</p>
      <div>
        <Label htmlFor="ai-url">Endereço do servidor</Label>
        <div className="flex gap-2">
          <TextInput id="ai-url" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button variant="ghost" onClick={() => save.mutate({ openaiBaseUrl: url })} disabled={url === settings.openaiBaseUrl}>
            Salvar
          </Button>
        </div>
      </div>
      <KeyField provider="openai" saved={hasKey} label="Chave de API (opcional em servidores locais)" />
      <ModelPicker key={settings.openaiBaseUrl} provider="openai" settings={settings} ready />
    </div>
  )
}

export function AiSettings({ settings }: { settings: AppSettings }) {
  const save = useSaveSettings()
  const keys = useQuery(aiKeysQuery)
  const provider = settings.aiProvider
  const hasKey = provider !== 'none' && Boolean(keys.data?.[provider])

  return (
    <div className="space-y-5">
      <div role="radiogroup" aria-label="Provedor de IA" className="grid gap-2 sm:grid-cols-2">
        {AI_PROVIDER_IDS.map((id) => {
          const info = AI_PROVIDERS[id]
          const active = provider === id
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => save.mutate({ aiProvider: id })}
              className={`rounded-lg border p-3 text-left ${active ? 'border-accent bg-accent-soft' : 'border-border hover:bg-surface-2'}`}
            >
              <span className="flex items-center gap-2">
                <span className={`text-sm font-medium ${active ? 'text-accent' : ''}`}>{info.label}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${BADGE_STYLE[info.badge]}`}>{info.badge}</span>
              </span>
              <span className="mt-0.5 block text-xs text-muted">{info.tagline}</span>
            </button>
          )
        })}
        <button
          type="button"
          role="radio"
          aria-checked={provider === 'none'}
          onClick={() => save.mutate({ aiProvider: 'none' })}
          className={`rounded-lg border p-3 text-left text-sm ${provider === 'none' ? 'border-accent bg-accent-soft text-accent' : 'border-border text-muted hover:bg-surface-2'}`}
        >
          Desligada
          <span className="mt-0.5 block text-xs text-muted">Nenhum material é enviado</span>
        </button>
      </div>

      {provider !== 'none' && (
        <div className="border-t border-border pt-5">
          {provider === 'gemini' && <GeminiPanel settings={settings} hasKey={hasKey} />}
          {provider === 'openrouter' && <OpenRouterPanel settings={settings} hasKey={hasKey} />}
          {provider === 'ollama' && <OllamaPanel settings={settings} />}
          {provider === 'anthropic' && <AnthropicPanel settings={settings} hasKey={hasKey} />}
          {provider === 'openai' && <OpenAiPanel settings={settings} hasKey={hasKey} />}
        </div>
      )}
    </div>
  )
}
