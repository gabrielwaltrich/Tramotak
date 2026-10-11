import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { DEFAULT_EXAM_SETTINGS, type ExamSelection, type ExamSettings } from '@shared/exams'
import { plural } from '@shared/format'
import type { Question } from '@shared/questions'
import { matches } from '@shared/search'
import { errorMessage } from '../../lib/api'
import { Modal } from '../Modal'
import { Button } from '../Button'
import { Label, Segmented, TextInput } from '../Field'
import { RichText } from '../RichText'
import { useToast } from '../Toast'

const DIFFICULTY = ['Muito fácil', 'Fácil', 'Média', 'Difícil', 'Muito difícil']

export function ExamDialog({ open, bankId, questions, topics, onClose, onCreated }: {
  open: boolean
  bankId: number
  questions: Question[]
  topics: string[]
  onClose: () => void
  onCreated: (examId: number) => void
}) {
  return (
    <Modal open={open} onClose={onClose} title="Novo simulado" wide>
      {open && <ExamForm bankId={bankId} questions={questions} topics={topics} onClose={onClose} onCreated={onCreated} />}
    </Modal>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--accent)]" />
      {label}
    </label>
  )
}

function ExamForm({ bankId, questions, topics, onClose, onCreated }: {
  bankId: number
  questions: Question[]
  topics: string[]
  onClose: () => void
  onCreated: (examId: number) => void
}) {
  const [title, setTitle] = useState(`Simulado ${new Date().toLocaleDateString('pt-BR')}`)
  const [mode, setMode] = useState<'random' | 'manual'>('random')
  const [count, setCount] = useState(String(Math.min(10, questions.length || 10)))
  const [chosenTopics, setChosenTopics] = useState<string[]>([])
  const [difficulties, setDifficulties] = useState<number[]>([])
  const [picked, setPicked] = useState<number[]>([])
  const [filter, setFilter] = useState('')
  const [settings, setSettings] = useState<ExamSettings>(DEFAULT_EXAM_SETTINGS)
  const [limit, setLimit] = useState('')
  const set = <K extends keyof ExamSettings>(k: K, v: ExamSettings[K]) => setSettings((s) => ({ ...s, [k]: v }))
  const queryClient = useQueryClient()
  const toast = useToast()

  const pool = useMemo(
    () =>
      questions.filter(
        (q) => (chosenTopics.length === 0 || chosenTopics.includes(q.topic)) && (difficulties.length === 0 || difficulties.includes(q.difficulty))
      ),
    [questions, chosenTopics, difficulties]
  )
  const visible = useMemo(() => questions.filter((q) => matches(filter, q.statement, q.topic)), [questions, filter])
  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value])

  const selection = (): ExamSelection =>
    mode === 'manual' ? { mode, questionIds: picked } : { mode, count: Number(count), topics: chosenTopics, difficulties }

  const create = useMutation({
    mutationFn: () => window.api.exams.create(bankId, { title, selection: selection(), settings: { ...settings, timeLimitMin: limit ? Number(limit) : null } }),
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ['exams', bankId] })
      onClose()
      onCreated(id)
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  const ready = title.trim() && (mode === 'manual' ? picked.length > 0 : Number(count) > 0 && pool.length > 0)

  return (
    <div className="space-y-5">
      <div>
        <Label htmlFor="exam-title">Nome</Label>
        <TextInput id="exam-title" value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus />
      </div>

      <div>
        <Label>Questões</Label>
        <Segmented
          label="Como escolher as questões"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'random', label: 'Sortear por critérios' },
            { value: 'manual', label: 'Escolher à mão' }
          ]}
        />
      </div>

      {mode === 'random' ? (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="flex items-center gap-2 text-sm">
            Sortear
            <TextInput type="number" min={1} max={500} step={1} value={count} onChange={(e) => setCount(e.target.value)} className="w-20" aria-label="Quantidade de questões" />
            de {plural(pool.length, 'questão disponível', 'questões disponíveis')}
          </div>
          {topics.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs text-muted">Tópicos (nenhum marcado = todos)</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {topics.map((t) => (
                  <Toggle key={t} label={t} checked={chosenTopics.includes(t)} onChange={() => setChosenTopics(toggle(chosenTopics, t))} />
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="mb-1.5 text-xs text-muted">Dificuldade (nenhuma marcada = todas)</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {DIFFICULTY.map((d, i) => (
                <Toggle key={d} label={d} checked={difficulties.includes(i + 1)} onChange={() => setDifficulties(toggle(difficulties, i + 1))} />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <div className="flex items-center gap-2 border-b border-border p-2">
            <TextInput value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar questões…" aria-label="Filtrar questões" />
            <span className="shrink-0 text-xs text-muted">{plural(picked.length, 'escolhida')}</span>
          </div>
          <ul className="max-h-56 overflow-y-auto p-1">
            {visible.map((q) => (
              <li key={q.id}>
                <label className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-2">
                  <input type="checkbox" checked={picked.includes(q.id)} onChange={() => setPicked(toggle(picked, q.id))} className="mt-0.5 size-4 accent-[var(--accent)]" />
                  <span className="line-clamp-2 flex-1">
                    <RichText text={q.statement} />
                  </span>
                  {q.topic && <span className="shrink-0 text-xs text-muted">{q.topic}</span>}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="exam-limit">Tempo limite</label>
            <TextInput id="exam-limit" type="number" min={1} max={600} step={1} value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="sem" className="w-20" />
            min
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="exam-pass">Nota de corte</label>
            <TextInput id="exam-pass" type="number" min={0} max={100} step={1} value={settings.passPercent} onChange={(e) => set('passPercent', Number(e.target.value))} className="w-20" />%
          </div>
          <div>
            <p className="mb-1.5 text-sm">Correção</p>
            <Segmented
              label="Correção"
              value={settings.feedback}
              onChange={(v) => set('feedback', v)}
              options={[
                { value: 'after_submit', label: 'Ao enviar' },
                { value: 'immediate', label: 'A cada questão' }
              ]}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Toggle label="Embaralhar a ordem das questões" checked={settings.shuffleQuestions} onChange={(v) => set('shuffleQuestions', v)} />
          <Toggle label="Embaralhar as alternativas" checked={settings.shuffleOptions} onChange={(v) => set('shuffleOptions', v)} />
          <Toggle label="Permitir voltar a questões anteriores" checked={settings.allowBack} onChange={(v) => set('allowBack', v)} />
          <p className="pt-1 text-xs text-muted">Durante a prova, sair da janela do Tramotak gera um aviso e fica registrado no resultado.</p>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={() => create.mutate()} disabled={!ready || create.isPending}>
          Criar simulado
        </Button>
      </div>
    </div>
  )
}
