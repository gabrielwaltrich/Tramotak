import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Globe, Loader2, Settings, Sparkles, X } from 'lucide-react'
import {
  AI_PROVIDERS,
  AI_TASK_LABEL,
  composeMaterial,
  COUNT_LIMITS,
  type AiGenerateResponse,
  type AiQuestionType,
  type AiSource,
  type AiTask
} from '@shared/ai'
import { QUESTION_TYPE_LABEL } from '@shared/questions'
import { errorMessage, queryKeys } from '../lib/api'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { Button } from '../components/Button'
import { Label, Segmented, TextArea } from '../components/Field'
import { aiKeysQuery, aiReady } from '../components/ai/AiSettings'
import { SourcePicker, selectedSections, useSource, type SourceState } from '../components/ai/SourcePicker'
import { SourceLinks } from '../components/ai/SourceLinks'
import { ResultReview } from '../components/ai/ResultReview'

const TASKS: AiTask[] = ['cards', 'questions', 'summary', 'mindmap']
const QUESTION_TYPES: AiQuestionType[] = ['single', 'multiple', 'truefalse', 'short']

function Card({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="mb-4 flex items-center gap-2 font-medium">
        <span className="grid size-6 place-items-center rounded-full bg-accent-soft text-xs text-accent">{step}</span>
        {title}
      </h2>
      {children}
    </section>
  )
}

/** Segundos desde que montou (o tempo de espera da geração). */
function Elapsed() {
  const [started] = useState(() => Date.now())
  const [now, setNow] = useState(started)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return <span className="tabular-nums">{Math.floor((now - started) / 1000)}s</span>
}

const numberParam = (value: string | null) => (value && /^\d+$/.test(value) ? Number(value) : null)

export function AiPage() {
  const [params] = useSearchParams()
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: () => window.api.settings.get(), staleTime: 0 })
  const keys = useQuery({ ...aiKeysQuery, staleTime: 0 })

  const lessonParam = numberParam(params.get('lesson'))
  const pageParam = numberParam(params.get('page'))
  const deckId = numberParam(params.get('deck'))
  const bankId = numberParam(params.get('bank'))
  const taskParam = params.get('task') as AiTask | null

  const [state, setState] = useState<SourceState>({
    mode: pageParam ? 'page' : 'lesson',
    courseId: null,
    lessonId: lessonParam,
    notebookId: numberParam(params.get('notebook')),
    pageId: pageParam,
    pastedTitle: '',
    pastedText: '',
    sections: null
  })
  const onChange = useCallback((patch: Partial<SourceState>) => setState((s) => ({ ...s, ...patch })), [])
  const { source, loading, error } = useSource(state)

  const [task, setTask] = useState<AiTask>(taskParam && TASKS.includes(taskParam) ? taskParam : deckId ? 'cards' : bankId ? 'questions' : 'cards')
  const [count, setCount] = useState(10)
  const [types, setTypes] = useState<AiQuestionType[]>(['single', 'truefalse'])
  const [instructions, setInstructions] = useState('')
  const queryClient = useQueryClient()
  const web = Boolean(settings.data?.aiWebSearch)
  const setWeb = useMutation({
    mutationFn: (value: boolean) => window.api.settings.update({ aiWebSearch: value }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings })
  })
  const [generated, setGenerated] = useState<{ id: number; response: AiGenerateResponse; source: AiSource } | null>(null)

  const generate = useMutation({
    mutationFn: (src: AiSource) =>
      window.api.ai
        .generate({ task, title: src.title, text: composeMaterial(src.sections, selectedSections(state, src)), count, questionTypes: types, instructions, webSearch: web })
        .then((response) => ({ id: Date.now(), response, source: src })),
    onMutate: () => setGenerated(null),
    onSuccess: setGenerated
  })

  if (!settings.data || keys.isPending) return <Loader2 className="mx-auto my-20 animate-spin text-muted" />

  const provider = settings.data.aiProvider
  if (!aiReady(settings.data, keys.data)) {
    return (
      <div className="mx-auto max-w-4xl p-8">
        <PageHeader title="IA" subtitle="Flashcards, questões, resumos e mapas mentais a partir das suas aulas" />
        <EmptyState
          icon={<Sparkles size={22} />}
          title={provider === 'none' ? 'Escolha um provedor de IA' : 'Falta a chave de API'}
          description="Dá para começar de graça: Gemini com a sua conta Google, modelos gratuitos do OpenRouter ou um modelo leve (Llama, Qwen) rodando no seu computador pelo Ollama. Nada é enviado sem você pedir."
          action={
            <Link to="/settings" className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-white hover:brightness-110">
              <Settings size={16} /> Abrir Configurações
            </Link>
          }
        />
      </div>
    )
  }

  const info = AI_PROVIDERS[provider as Exclude<typeof provider, 'none'>]
  const model = settings.data.aiModels[info.id]
  const materialChars = source ? composeMaterial(source.sections, selectedSections(state, source)).trim().length : 0
  const usable = source !== null && materialChars >= 50
  const canWeb = info.web !== null
  const needsCount = task === 'cards' || task === 'questions'

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-8">
      <PageHeader
        title="IA"
        subtitle="Flashcards, questões, resumos e mapas mentais a partir das suas aulas"
        actions={
          <Link to="/settings" className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:text-text" title="Trocar provedor ou modelo">
            <Sparkles size={14} className="text-accent" />
            {info.label} · <span className="font-mono">{model}</span>
          </Link>
        }
      />

      <Card step={1} title="Material">
        <SourcePicker state={state} onChange={onChange} source={source} loading={loading} error={error} maxChars={info.maxSourceChars} />
      </Card>

      <Card step={2} title="O que gerar">
        <div className="space-y-4">
          <Segmented label="Tipo de geração" value={task} onChange={setTask} options={TASKS.map((t) => ({ value: t, label: AI_TASK_LABEL[t] }))} />
          {needsCount && (
            <div className="flex items-center gap-2 text-sm">
              <label htmlFor="ai-count" className="text-muted">
                Quantidade
              </label>
              <input
                id="ai-count"
                type="number"
                min={COUNT_LIMITS.min}
                max={COUNT_LIMITS.max}
                step={1}
                value={count}
                onChange={(e) => setCount(Math.min(COUNT_LIMITS.max, Math.max(COUNT_LIMITS.min, Number(e.target.value) || COUNT_LIMITS.min)))}
                className="h-9 w-20 rounded-md border border-border bg-bg px-3 text-sm tabular-nums focus:border-accent focus:outline-none"
              />
            </div>
          )}
          {task === 'questions' && (
            <fieldset className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <legend className="sr-only">Tipos de questão</legend>
              {QUESTION_TYPES.map((t) => (
                <label key={t} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={types.includes(t)}
                    onChange={(e) => setTypes((list) => (e.target.checked ? [...list, t] : list.filter((x) => x !== t)))}
                    className="size-4 accent-[var(--accent)]"
                  />
                  {QUESTION_TYPE_LABEL[t]}
                </label>
              ))}
            </fieldset>
          )}
          <div>
            <Label htmlFor="ai-instructions">Instruções extras (opcional)</Label>
            <TextArea
              id="ai-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              maxLength={1000}
              placeholder="Ex.: foque nas fórmulas; nível de concurso; evite datas"
              className="min-h-16"
            />
          </div>
          {canWeb ? (
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" checked={web} onChange={(e) => setWeb.mutate(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
              <span>
                <Globe size={14} className="mr-1 inline text-accent" />
                Permitir pesquisa na internet para conferir e complementar os conceitos da aula
                <span className="block text-xs text-muted">Usa a {info.web}. As perguntas continuam sendo só sobre os temas da aula.</span>
              </span>
            </label>
          ) : (
            <p className="text-xs text-muted">{info.label} não pesquisa na internet: a IA usa só o material marcado.</p>
          )}
          {info.cloud && usable && <p className="text-xs text-muted">Ao gerar, o material marcado é enviado a {info.label}.</p>}
          {source !== null && !usable && <p className="text-xs text-warning">Material curto demais para gerar algo útil: marque mais partes ou use outra aula.</p>}
          <div className="flex items-center gap-3">
            {generate.isPending ? (
              <>
                <Button disabled>
                  <Loader2 size={16} className="animate-spin" /> Gerando… <Elapsed />
                </Button>
                <Button variant="ghost" onClick={() => window.api.ai.cancel()}>
                  <X size={16} /> Cancelar
                </Button>
              </>
            ) : (
              <Button onClick={() => source && generate.mutate(source)} disabled={!usable || (task === 'questions' && types.length === 0)}>
                <Sparkles size={16} /> Gerar {AI_TASK_LABEL[task].toLowerCase()}
              </Button>
            )}
          </div>
          {generate.error && errorMessage(generate.error) !== 'Cancelado' && <p className="text-sm text-red-500">{errorMessage(generate.error)}</p>}
        </div>
      </Card>

      {generated && (
        <Card step={3} title={`Revisar e salvar · ${AI_TASK_LABEL[generated.response.result.task].toLowerCase()}`}>
          {generated.response.truncated && (
            <p className="mb-4 flex items-start gap-2 text-xs text-warning">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              O material foi cortado em {generated.response.usedChars.toLocaleString('pt-BR')} caracteres; o fim da aula ficou de fora.
            </p>
          )}
          <p className="mb-4 text-xs text-muted">
            Gerado por {AI_PROVIDERS[generated.response.provider].label} · {generated.response.model}. A IA pode errar: confira antes de salvar.
          </p>
          <SourceLinks sources={generated.response.sources} className="mb-4" />
          <ResultReview key={generated.id} result={generated.response.result} source={generated.source} deckId={deckId} bankId={bankId} />
        </Card>
      )}
    </div>
  )
}
