import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react'
import type { CourseDetail } from '@shared/course'
import { applyTitleRules, NUMBER_FORMATS, RECOMMENDED_RULES, sampleNames, type CodeNumber, type TitleRules } from '@shared/titleRules'
import { AI_PROVIDERS } from '@shared/ai'
import { plural } from '@shared/format'
import { errorMessage, queryKeys } from '../lib/api'
import { Modal } from './Modal'
import { Button } from './Button'
import { Label, Segmented, TextArea, TextInput } from './Field'
import { useToast } from './Toast'
import { aiKeysQuery, aiReady } from './ai/AiSettings'

/** Nomes dos arquivos das aulas (sem extensão), na ordem do curso. */
function fileNames(course: CourseDetail): string[] {
  const out: string[] = []
  const add = (lessons: CourseDetail['lessons']) => {
    for (const l of lessons) {
      const name = l.relPath.split('/').pop() ?? l.relPath
      out.push(name.replace(/\.[^.]+$/, ''))
    }
  }
  const walk = (mods: CourseDetail['modules']) => mods.forEach((m) => (add(m.lessons), walk(m.children)))
  add(course.lessons)
  walk(course.modules)
  return out
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 py-1 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
      <span>
        {label}
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </label>
  )
}

export function TitleRulesDialog({ course, open, onClose }: { course: CourseDetail; open: boolean; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [rules, setRules] = useState<TitleRules>(course.titleRules.enabled ? course.titleRules : RECOMMENDED_RULES)
  const [aiRequest, setAiRequest] = useState('')
  const [showAll, setShowAll] = useState(false)
  const names = useMemo(() => fileNames(course), [course])
  const samples = useMemo(() => (showAll ? names : sampleNames(names, 10)), [names, showAll])
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: () => window.api.settings.get(), staleTime: 0 })
  const keys = useQuery({ ...aiKeysQuery, staleTime: 0 })
  const canAi = aiReady(settings.data, keys.data)
  const set = (patch: Partial<TitleRules>) => setRules((r) => ({ ...r, ...patch }))

  const save = useMutation({
    mutationFn: () => window.api.courses.setTitleRules(course.id, rules),
    onSuccess: async (changed) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.courses })
      toast(changed ? `${plural(changed, 'título atualizado', 'títulos atualizados')}` : 'Regras salvas (nenhum título mudou)')
      onClose()
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const suggest = useMutation({
    mutationFn: () => window.api.ai.suggestTitleRules(course.id, aiRequest),
    onSuccess: (suggested) => {
      setRules(suggested)
      toast('Sugestão da IA aplicada na prévia; confira antes de salvar')
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  const provider = settings.data?.aiProvider
  const providerLabel = provider && provider !== 'none' ? AI_PROVIDERS[provider].label : null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nomes das aulas"
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 size={16} className="animate-spin" />} Salvar e aplicar
          </Button>
        </>
      }
    >
      <div className="space-y-5 text-sm">
        <p className="text-xs text-muted">
          Os arquivos não são renomeados: as regras só mudam como os títulos aparecem no Tramotak. Revalidar ou trocar a pasta do curso mantém as regras.
        </p>

        <Toggle checked={rules.enabled} onChange={(enabled) => set({ enabled })} label="Usar regras de nomes neste curso" hint="Desligado, os títulos voltam ao padrão (o nome do arquivo sem a numeração inicial)." />

        <div className={`space-y-5 ${rules.enabled ? '' : 'pointer-events-none opacity-50'}`}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Código no início (ex.: #F0009)</Label>
              <Segmented<CodeNumber>
                label="Código no início"
                value={rules.codeNumber}
                onChange={(codeNumber) => set({ codeNumber })}
                options={[
                  { value: 'keep', label: 'Só o número' },
                  { value: 'remove', label: 'Tirar' },
                  { value: 'off', label: 'Não mexer' }
                ]}
              />
            </div>
            {rules.codeNumber === 'keep' && (
              <div>
                <Label htmlFor="number-format">Formato do número</Label>
                <select
                  id="number-format"
                  value={rules.numberFormat}
                  onChange={(e) => set({ numberFormat: e.target.value as TitleRules['numberFormat'] })}
                  className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-text"
                >
                  {NUMBER_FORMATS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="grid gap-x-6 sm:grid-cols-2">
            <Toggle checked={rules.removeDates} onChange={(removeDates) => set({ removeDates })} label="Tirar datas" hint="2026-02-20, 20-02-2026…" />
            <Toggle checked={rules.removeInnerNumber} onChange={(removeInnerNumber) => set({ removeInnerNumber })} label="Tirar a numeração interna" hint='O "01", "02" que vem depois do código/data' />
            <Toggle checked={rules.removeAfterAt} onChange={(removeAfterAt) => set({ removeAfterAt })} label="Tirar autor e tudo depois do @" hint='"By @autor", "Por @canal"…' />
            <Toggle checked={rules.removeEmojis} onChange={(removeEmojis) => set({ removeEmojis })} label="Tirar emojis" hint="❤️‍🔥, 🚀…" />
            <Toggle checked={rules.underscoresToSpaces} onChange={(underscoresToSpaces) => set({ underscoresToSpaces })} label="Trocar _ por espaço" hint="Como_usar_SSH → Como usar SSH" />
            <Toggle checked={rules.removeCopySuffix} onChange={(removeCopySuffix) => set({ removeCopySuffix })} label="Tirar sufixos de cópia" hint='" (1)", " (2)" no fim' />
            <Toggle checked={rules.capitalize} onChange={(capitalize) => set({ capitalize })} label="Primeira letra maiúscula" hint="introdução → Introdução" />
            <Toggle checked={rules.applyToModules} onChange={(applyToModules) => set({ applyToModules })} label="Aplicar também às pastas (módulos)" hint="Desligado, as pastas ficam como estão" />
          </div>

          <div>
            <Label htmlFor="remove-terms">Tirar estes textos (separe por vírgula)</Label>
            <TextInput
              id="remove-terms"
              value={rules.removeTerms.join(', ')}
              onChange={(e) => set({ removeTerms: e.target.value.split(',').map((t) => t.trimStart()) })}
              onBlur={() => set({ removeTerms: rules.removeTerms.map((t) => t.trim()).filter(Boolean) })}
              placeholder="Ex.: Aula completa, [HD]"
            />
          </div>

          <div>
            <Label>Trocar textos</Label>
            <div className="space-y-2">
              {rules.replacements.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <TextInput value={r.from} onChange={(e) => set({ replacements: rules.replacements.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)) })} placeholder="De" aria-label={`Troca ${i + 1}: de`} />
                  <ArrowRight size={14} className="shrink-0 text-muted" />
                  <TextInput value={r.to} onChange={(e) => set({ replacements: rules.replacements.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)) })} placeholder="Para" aria-label={`Troca ${i + 1}: para`} />
                  <button type="button" onClick={() => set({ replacements: rules.replacements.filter((_, j) => j !== i) })} className="text-muted hover:text-red-400" aria-label={`Remover troca ${i + 1}`}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => set({ replacements: [...rules.replacements, { from: '', to: '' }] })} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                <Plus size={12} /> Adicionar troca
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-bg/50 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium">
            <Sparkles size={14} className="text-accent" /> Pedir ajuda à IA (opcional)
          </p>
          {canAi ? (
            <>
              <TextArea value={aiRequest} onChange={(e) => setAiRequest(e.target.value)} placeholder="Descreva como quer os nomes, ou deixe em branco para a IA sugerir" className="min-h-14" maxLength={1000} />
              <div className="mt-2 flex items-center gap-3">
                <Button variant="ghost" className="h-8" onClick={() => suggest.mutate()} disabled={suggest.isPending}>
                  {suggest.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Sugerir regras
                </Button>
                <span className="text-xs text-muted">Envia {Math.min(20, names.length)} nomes de arquivo de exemplo para {providerLabel}. A IA só escolhe as opções acima.</span>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted">Configure um provedor de IA nas Configurações para pedir sugestões.</p>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label>Prévia</Label>
            <button type="button" onClick={() => setShowAll((v) => !v)} className="text-xs text-accent hover:underline">
              {showAll ? 'Mostrar só exemplos' : `Ver todas as ${names.length} aulas`}
            </button>
          </div>
          <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {samples.map((name, i) => (
              <li key={`${i}-${name}`} className="grid gap-0.5 px-3 py-2">
                <span className="truncate font-mono text-[11px] text-muted" title={name}>
                  {name}
                </span>
                <span className="truncate">{rules.enabled ? applyTitleRules(name, rules) : name.replace(/^\s*\d+(?:\.\d+)*\s*[.)\-–—_]\s*/, '')}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  )
}
