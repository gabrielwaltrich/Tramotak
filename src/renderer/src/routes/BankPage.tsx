import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Download, FileUp, Loader2, MoreVertical, Pencil, Play, Plus, RotateCcw, Search, Sparkles, Trash2 } from 'lucide-react'
import type { BankAnalytics, Exam } from '@shared/exams'
import { plural } from '@shared/format'
import { QUESTION_TYPE_LABEL, type QuestionType } from '@shared/questions'
import { matches } from '@shared/search'
import { errorMessage } from '../lib/api'
import { useWidth } from '../lib/useWidth'
import { Button } from '../components/Button'
import { TextInput } from '../components/Field'
import { Menu } from '../components/Menu'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { RichText } from '../components/RichText'
import { BankDialog } from '../components/questions/BankDialog'
import { QuestionEditor, type EditorState } from '../components/questions/QuestionEditor'
import { ExamDialog } from '../components/questions/ExamDialog'
import { ChartTooltip } from '../components/progress/ChartTooltip'
import { useToast } from '../components/Toast'

type Tab = 'questions' | 'exams' | 'analytics'
const SELECT = 'h-9 rounded-md border border-border bg-bg px-3 text-sm text-text'
const fmtPercent = (p: number) => `${p.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

function Difficulty({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5" title={`Dificuldade ${value} de 5`} aria-label={`Dificuldade ${value} de 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`size-1.5 rounded-full ${i <= value ? 'bg-accent' : 'bg-surface-2'}`} />
      ))}
    </span>
  )
}

function QuestionsTab({ bankId, topics }: { bankId: number; topics: string[] }) {
  const [editor, setEditor] = useState<EditorState>(null)
  const [text, setText] = useState('')
  const [topic, setTopic] = useState('')
  const [type, setType] = useState<QuestionType | ''>('')
  const queryClient = useQueryClient()
  const questions = useQuery({ queryKey: ['questions', bankId], queryFn: () => window.api.questions.list(bankId), staleTime: 0 })
  const visible = useMemo(
    () => (questions.data ?? []).filter((q) => (!topic || q.topic === topic) && (!type || q.type === type) && matches(text, q.statement, q.explanation, q.topic)),
    [questions.data, text, topic, type]
  )
  const refreshBank = () => queryClient.invalidateQueries({ queryKey: ['banks'] })

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <TextInput value={text} onChange={(e) => setText(e.target.value)} placeholder="Buscar no enunciado…" className="pl-9" aria-label="Buscar questões" />
        </div>
        <select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Tópico" className={SELECT}>
          <option value="">Todos os tópicos</option>
          {topics.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value as QuestionType | '')} aria-label="Tipo" className={SELECT}>
          <option value="">Todos os tipos</option>
          {(Object.keys(QUESTION_TYPE_LABEL) as QuestionType[]).map((t) => (
            <option key={t} value={t}>
              {QUESTION_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <Button onClick={() => setEditor({ mode: 'create' })}>
          <Plus size={16} /> Nova questão
        </Button>
      </div>

      {questions.isPending ? (
        <div className="grid place-items-center py-16 text-muted">
          <Loader2 className="animate-spin" />
        </div>
      ) : (questions.data ?? []).length === 0 ? (
        <p className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted">Nenhuma questão ainda. Crie a primeira ou importe um arquivo.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {visible.map((q) => (
            <li key={q.id}>
              <button type="button" onClick={() => setEditor({ mode: 'edit', question: q })} className="flex w-full items-start gap-4 px-4 py-3 text-left hover:bg-surface-2/50">
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm">
                    <RichText text={q.statement} />
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                    <span>{QUESTION_TYPE_LABEL[q.type]}</span>
                    {q.topic && <span>{q.topic}</span>}
                    <span>{plural(q.points, 'ponto')}</span>
                  </p>
                </div>
                <Difficulty value={q.difficulty} />
              </button>
            </li>
          ))}
          {visible.length === 0 && <li className="py-8 text-center text-sm text-muted">Nenhuma questão com esses filtros.</li>}
        </ul>
      )}

      <QuestionEditor state={editor} bankId={bankId} topics={topics} onClose={() => setEditor(null)} onSaved={refreshBank} />
    </>
  )
}

function ExamsTab({ bankId, topics }: { bankId: number; topics: string[] }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Exam | null>(null)
  const exams = useQuery({ queryKey: ['exams', bankId], queryFn: () => window.api.exams.list(bankId), staleTime: 0 })
  const questions = useQuery({ queryKey: ['questions', bankId], queryFn: () => window.api.questions.list(bankId) })

  const start = useMutation({
    mutationFn: (examId: number) => window.api.attempts.start(examId),
    onSuccess: (attemptId) => navigate(`/questions/attempt/${attemptId}`),
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const remove = useMutation({
    mutationFn: (id: number) => window.api.exams.delete(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['exams', bankId] })
      setDeleting(null)
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  const describe = (e: Exam) =>
    [
      e.selection.mode === 'manual' ? plural(e.selection.questionIds.length, 'questão escolhida', 'questões escolhidas') : `${plural(e.selection.count, 'questão sorteada', 'questões sorteadas')}`,
      e.settings.timeLimitMin ? `${e.settings.timeLimitMin} min` : 'sem tempo',
      `corte ${e.settings.passPercent}%`,
      e.settings.feedback === 'immediate' ? 'correção a cada questão' : 'correção ao enviar'
    ].join(' · ')

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setCreating(true)} disabled={!questions.data?.length}>
          <Plus size={16} /> Novo simulado
        </Button>
      </div>
      {exams.data?.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted">
          {questions.data?.length ? 'Crie um simulado para treinar com as questões deste banco.' : 'Adicione questões ao banco antes de criar um simulado.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {exams.data?.map((e) => (
            <li key={e.id} className="flex items-center gap-4 rounded-xl border border-border bg-surface px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{e.title}</p>
                <p className="truncate text-xs text-muted">{describe(e)}</p>
              </div>
              {e.attemptCount > 0 && (
                <div className="text-right text-xs text-muted">
                  <span className="block text-sm font-semibold text-text tabular-nums">{fmtPercent(e.lastPercent!)}</span>
                  última · melhor {fmtPercent(e.bestPercent!)}
                </div>
              )}
              <Button onClick={() => start.mutate(e.id)} disabled={start.isPending} className="w-32">
                {e.inProgressAttemptId ? <RotateCcw size={16} /> : <Play size={16} fill="currentColor" />}
                {e.inProgressAttemptId ? 'Continuar' : e.attemptCount ? 'Refazer' : 'Começar'}
              </Button>
              <Menu label={`Ações de ${e.title}`} trigger={<MoreVertical size={16} />} items={[{ label: 'Excluir', icon: <Trash2 size={14} />, onSelect: () => setDeleting(e), danger: true }]} />
            </li>
          ))}
        </ul>
      )}
      <ExamDialog
        open={creating}
        bankId={bankId}
        questions={questions.data ?? []}
        topics={topics}
        onClose={() => setCreating(false)}
        onCreated={() => toast('Simulado criado')}
      />
      <ConfirmDialog open={deleting !== null} title="Excluir simulado" confirmLabel="Excluir" busy={remove.isPending} onClose={() => setDeleting(null)} onConfirm={() => deleting && remove.mutate(deleting.id)}>
        <p>
          Excluir <strong className="text-text">“{deleting?.title}”</strong> e o histórico de {plural(deleting?.attemptCount ?? 0, 'tentativa')}? As questões continuam no banco.
        </p>
      </ConfirmDialog>
    </>
  )
}

/** Notas das tentativas em ordem cronológica, com a linha da nota de corte mais usada. */
function ScoreChart({ attempts }: { attempts: BankAnalytics['attempts'] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const data = attempts.filter((a) => a.percent !== null).slice(0, 20).reverse()
  const H = 160
  const pad = { top: 10, right: 8, bottom: 8, left: 34 }
  const plotW = Math.max(0, width - pad.left - pad.right)
  const plotH = H - pad.top - pad.bottom
  const slot = data.length ? plotW / data.length : 0
  const barW = Math.min(24, Math.max(2, slot - 2))
  const y = (p: number) => pad.top + plotH - (p / 100) * plotH
  const column = (x: number, top: number, w: number) => {
    const h = pad.top + plotH - top
    if (h <= 0) return ''
    const r = Math.min(4, w / 2, h)
    return `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${top + h} Z`
  }
  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={`Notas das últimas ${data.length} tentativas`}>
          {[0, 25, 50, 75, 100].map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={pad.left - 6} y={y(t) + 3} textAnchor="end" className="fill-[var(--text-muted)] text-[10px] tabular-nums">
                {t}%
              </text>
            </g>
          ))}
          {data.map((a, i) => (
            <g key={a.id} onMouseEnter={() => setHover(i)}>
              <rect x={pad.left + i * slot} y={pad.top} width={slot} height={plotH} fill="transparent" />
              <path d={column(pad.left + i * slot + (slot - barW) / 2, y(a.percent!), barW)} fill="var(--accent)" opacity={hover === null || hover === i ? 1 : 0.55} />
            </g>
          ))}
        </svg>
      )}
      {hover !== null && data[hover] && (
        <ChartTooltip
          x={pad.left + hover * slot + slot / 2}
          y={y(data[hover].percent!)}
          value={fmtPercent(data[hover].percent!)}
          label={`${data[hover].examTitle} · ${new Date(data[hover].startedAt * 1000).toLocaleDateString('pt-BR')}`}
        />
      )}
    </div>
  )
}

function AnalyticsTab({ bankId }: { bankId: number }) {
  const analytics = useQuery({ queryKey: ['bank-analytics', bankId], queryFn: () => window.api.banks.analytics(bankId), staleTime: 0 })
  if (analytics.isPending) return <Loader2 className="mx-auto my-16 animate-spin text-muted" />
  const a = analytics.data!
  const done = a.attempts.filter((x) => x.percent !== null)
  if (done.length === 0) return <p className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted">Faça um simulado para ver seu desempenho aqui.</p>
  const avg = done.reduce((n, x) => n + x.percent!, 0) / done.length

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="font-medium">Notas</h2>
        <p className="mt-0.5 text-sm text-muted">
          {plural(done.length, 'tentativa')} · média {fmtPercent(avg)} · {plural(done.filter((x) => x.passed).length, 'aprovação', 'aprovações')}
        </p>
        <div className="mt-4">
          <ScoreChart attempts={a.attempts} />
        </div>
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="font-medium">Acerto por tópico</h2>
          <p className="mt-0.5 text-sm text-muted">Do pior para o melhor</p>
          <ul className="mt-4 space-y-3">
            {a.byTopic.map((t) => {
              const p = Math.round((t.correct / t.answered) * 100)
              return (
                <li key={t.topic}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="truncate">{t.topic}</span>
                    <span className="shrink-0 text-xs text-muted tabular-nums">
                      {t.correct}/{t.answered} · {p}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-accent-soft" role="progressbar" aria-valuenow={p} aria-valuemax={100} aria-label={t.topic}>
                    <div className="h-full rounded-full bg-accent" style={{ width: `${p}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="font-medium">Questões que você mais erra</h2>
          {a.hardest.length === 0 ? (
            <p className="mt-4 text-sm text-muted">Nenhuma questão errada ainda. 🎯</p>
          ) : (
            <ol className="mt-4 space-y-2.5">
              {a.hardest.map((h) => (
                <li key={h.questionId} className="flex items-start gap-3 text-sm">
                  <span className="shrink-0 rounded bg-red-500/10 px-1.5 text-xs text-red-400 tabular-nums">
                    {h.answered - h.correct}/{h.answered}
                  </span>
                  <span className="line-clamp-2">
                    <RichText text={h.statement} />
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 font-medium">Tentativas</h2>
        <ul className="divide-y divide-border">
          {a.attempts.map((t) => (
            <li key={t.id}>
              <Link to={`/questions/attempt/${t.id}`} className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-surface-2">
                <span className="min-w-0 flex-1 truncate">{t.examTitle}</span>
                {t.focusLosses > 0 && <span className="text-xs text-warning">{plural(t.focusLosses, 'saída', 'saídas')} da janela</span>}
                <span className="w-24 text-right text-xs text-muted">{new Date(t.startedAt * 1000).toLocaleDateString('pt-BR')}</span>
                <span className={`w-20 text-right font-medium tabular-nums ${t.percent === null ? 'text-muted' : t.passed ? 'text-success' : 'text-red-400'}`}>
                  {t.percent === null ? 'em andamento' : fmtPercent(t.percent)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export function BankPage() {
  const bankId = Number(useParams().id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('questions')
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const bank = useQuery({ queryKey: ['banks', bankId], queryFn: () => window.api.banks.get(bankId), staleTime: 0 })
  const topics = useQuery({ queryKey: ['questions', bankId, 'topics'], queryFn: () => window.api.banks.topics(bankId), staleTime: 0 })

  const importFile = useMutation({
    mutationFn: () => window.api.banks.importFile(bankId),
    onSuccess: async (result) => {
      if (!result) return
      await queryClient.invalidateQueries({ queryKey: ['questions', bankId] })
      await queryClient.invalidateQueries({ queryKey: ['banks'] })
      toast(`${plural(result.imported, 'questão importada', 'questões importadas')}${result.skipped ? ` (${result.skipped} não suportadas)` : ''}`)
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const exportFile = useMutation({
    mutationFn: () => window.api.banks.exportFile(bankId),
    onSuccess: (path) => path && toast(`Exportado para ${path.split(/[\\/]/).pop()}`),
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const remove = useMutation({
    mutationFn: () => window.api.banks.delete(bankId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['banks'] })
      navigate('/questions')
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  if (bank.isPending) return <Loader2 className="mx-auto my-20 animate-spin text-muted" />
  if (bank.isError) return <p className="p-8 text-sm text-red-400">{errorMessage(bank.error)}</p>
  const b = bank.data

  const tabButton = (value: Tab, label: string) => (
    <button
      key={value}
      type="button"
      role="tab"
      aria-selected={tab === value}
      onClick={() => setTab(value)}
      className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === value ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="mx-auto max-w-5xl p-8">
      <Link to="/questions" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
        <ArrowLeft size={16} /> Questões
      </Link>
      <header className="mb-5 flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{b.title}</h1>
          {b.description && <p className="mt-1 text-sm text-muted">{b.description}</p>}
          <p className="mt-1 text-sm text-muted">
            {plural(b.questionCount, 'questão', 'questões')} · {plural(b.examCount, 'simulado')}
          </p>
        </div>
        <Button variant="ghost" onClick={() => navigate(`/ai?bank=${b.id}&task=questions`)}>
          <Sparkles size={16} /> Gerar com IA
        </Button>
        <Button variant="ghost" onClick={() => importFile.mutate()} disabled={importFile.isPending}>
          <FileUp size={16} /> Importar
        </Button>
        <Button variant="ghost" onClick={() => exportFile.mutate()} disabled={exportFile.isPending || b.questionCount === 0}>
          <Download size={16} /> Exportar
        </Button>
        <Menu
          label="Ações do banco"
          trigger={<MoreVertical size={16} />}
          items={[
            { label: 'Editar', icon: <Pencil size={14} />, onSelect: () => setEditing(true) },
            { label: 'Excluir banco', icon: <Trash2 size={14} />, onSelect: () => setDeleting(true), danger: true }
          ]}
        />
      </header>

      <div role="tablist" className="mb-5 flex gap-1 border-b border-border">
        {tabButton('questions', `Questões (${b.questionCount})`)}
        {tabButton('exams', `Simulados (${b.examCount})`)}
        {tabButton('analytics', 'Desempenho')}
      </div>

      {tab === 'questions' && <QuestionsTab bankId={bankId} topics={topics.data ?? []} />}
      {tab === 'exams' && <ExamsTab bankId={bankId} topics={topics.data ?? []} />}
      {tab === 'analytics' && <AnalyticsTab bankId={bankId} />}

      <BankDialog open={editing} bank={b} onClose={() => setEditing(false)} />
      <ConfirmDialog open={deleting} title="Excluir banco" confirmLabel="Excluir" busy={remove.isPending} onClose={() => setDeleting(false)} onConfirm={() => remove.mutate()}>
        <p>
          Excluir <strong className="text-text">“{b.title}”</strong> com {plural(b.questionCount, 'questão', 'questões')}, simulados e todo o histórico de tentativas?
        </p>
      </ConfirmDialog>
    </div>
  )
}
