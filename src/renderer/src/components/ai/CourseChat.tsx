import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Globe, Loader2, Mic, Search, Send, Sparkles, Square, Trash2, X } from 'lucide-react'
import { AI_PROVIDERS, clock, MAX_CHAT_QUESTION, type ChatMessage } from '@shared/ai'
import { COURSE_REF, courseRefLink, parseCourseRef } from '@shared/courseChat'
import { plural } from '@shared/format'
import { errorMessage, queryKeys } from '../../lib/api'
import { renderMarkdown } from '../../lib/markdown'
import { ConfirmDialog } from '../ConfirmDialog'
import { useToast } from '../Toast'
import { aiKeysQuery, aiReady } from './AiSettings'
import { SourceLinks } from './SourceLinks'

/** Começos de pergunta: entram no campo para a pessoa completar com o assunto. */
const STARTERS = ['Em quais aulas o curso fala de ', 'Explique, com base no curso, ', 'Qual a diferença entre ', 'Que aulas devo rever para entender ']

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** Markdown da resposta com as citações [A9 12:34] viradas em botões com o título da aula e o minuto (ou a página). */
function answerHtml(text: string, refs: Record<string, number> | undefined, titles: Map<number, string>): string {
  return renderMarkdown(text).replace(COURSE_REF, (match, ...groups) => {
    const ref = parseCourseRef([match, ...groups] as unknown as RegExpMatchArray)
    const lessonId = refs?.[ref.code]
    if (lessonId === undefined) return match
    const where = ref.sec !== null ? clock(ref.sec) : ref.page !== null ? `p. ${ref.page}` : ''
    const title = titles.get(lessonId) ?? 'Aula'
    const label = `${title}${where ? ` · ${where}` : ''}`
    return `<button type="button" class="tk-time tk-ref" data-href="${courseRefLink(lessonId, ref)}" title="${escapeHtml(label)}" aria-label="Abrir ${escapeHtml(label)}">${escapeHtml(
      title.length > 42 ? `${title.slice(0, 40)}…` : title
    )}${where ? ` · ${where}` : ''}</button>`
  })
}

function Answer({ message, titles }: { message: ChatMessage; titles: Map<number, string> }) {
  const navigate = useNavigate()
  const html = useMemo(() => answerHtml(message.content, message.refs, titles), [message.content, message.refs, titles])
  return (
    <div
      className="prose-tk text-sm"
      onClick={(e) => {
        const target = (e.target as HTMLElement).closest<HTMLElement>('[data-href]')
        if (target?.dataset.href) navigate(target.dataset.href.slice(1))
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/**
 * Conversa com a IA sobre o curso inteiro. A cada pergunta, a IA sugere termos, a busca local acha os trechos das
 * aulas (transcrição, legenda, texto, PDF) e só eles vão para a resposta, que cita aula e minuto.
 */
export function CourseChat({ courseId, lessonTitles, onTranscribe, onClose }: {
  courseId: number
  /** Títulos das aulas para mostrar nas citações (a IA não os recebe). */
  lessonTitles: Map<number, string>
  onTranscribe: () => void
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<{ question: string; answer: string } | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: () => window.api.settings.get(), staleTime: 0 })
  const keys = useQuery({ ...aiKeysQuery, staleTime: 0 })
  const chatKey = ['course-chat', courseId]
  const chat = useQuery({ queryKey: chatKey, queryFn: () => window.api.ai.courseChatGet(courseId), staleTime: 0 })

  useEffect(
    () =>
      window.api.ai.onCourseChatDelta((delta) => {
        if (delta.courseId === courseId) setPending((p) => (p ? { ...p, answer: p.answer + delta.text } : p))
      }),
    [courseId]
  )

  const messages = chat.data?.messages ?? []
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, pending?.answer])

  const provider = settings.data?.aiProvider ?? 'none'
  const info = provider === 'none' ? null : AI_PROVIDERS[provider]
  const web = Boolean(settings.data?.aiWebSearch) && info?.web != null

  const setWeb = useMutation({
    mutationFn: (value: boolean) => window.api.settings.update({ aiWebSearch: value }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings })
  })

  const send = useMutation({
    mutationFn: (text: string) => {
      setPending({ question: text, answer: '' })
      return window.api.ai.courseChatSend({ courseId, text, webSearch: web })
    },
    onSuccess: async () => {
      setDraft('')
      await queryClient.invalidateQueries({ queryKey: chatKey })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
    onSettled: () => setPending(null)
  })

  const clear = useMutation({
    mutationFn: () => window.api.ai.courseChatClear(courseId),
    onSuccess: () => {
      setConfirmClear(false)
      return queryClient.invalidateQueries({ queryKey: chatKey })
    }
  })

  const ask = (text: string) => {
    const q = text.trim()
    if (q && !send.isPending) send.mutate(q)
  }

  const header = (
    <div className="flex items-center gap-2 border-b border-border px-4 py-3">
      <Sparkles size={16} className="text-accent" />
      <h2 className="flex-1 text-sm font-medium">Perguntar ao curso</h2>
      {messages.length > 0 && (
        <button type="button" onClick={() => setConfirmClear(true)} className="inline-flex items-center gap-1 text-xs text-muted hover:text-red-400">
          <Trash2 size={12} /> Limpar
        </button>
      )}
      <button type="button" onClick={onClose} aria-label="Fechar a conversa" className="text-muted hover:text-text">
        <X size={16} />
      </button>
    </div>
  )

  let body: React.ReactNode
  if (!settings.data || keys.isPending || chat.isPending) {
    body = (
      <div className="grid flex-1 place-items-center gap-2 text-sm text-muted">
        <span className="inline-flex items-center gap-2">
          <Loader2 size={16} className="animate-spin" /> Preparando as aulas do curso…
        </span>
      </div>
    )
  } else if (!aiReady(settings.data, keys.data)) {
    body = (
      <p className="p-6 text-center text-sm text-muted">
        Para conversar com a IA sobre o curso, escolha um provedor (dá para usar de graça).{' '}
        <Link to="/settings" className="text-accent hover:underline">
          Abrir Configurações
        </Link>
      </p>
    )
  } else if (chat.isError) {
    body = <p className="p-6 text-sm text-red-400">{errorMessage(chat.error)}</p>
  } else {
    const material = chat.data.material
    body = (
      <>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2 text-xs text-muted">
          <span>
            Base: {material.withMaterial} de {plural(material.total, 'aula')} com transcrição, legenda, texto ou PDF
          </span>
          {material.withMaterial < material.total && (
            <button type="button" onClick={onTranscribe} className="inline-flex items-center gap-1 text-accent hover:underline">
              <Mic size={12} /> Transcrever o resto
            </button>
          )}
          {info?.web ? (
            <label className="flex cursor-pointer items-center gap-1.5" title={`Pesquisa: ${info.web}`}>
              <input type="checkbox" checked={web} onChange={(e) => setWeb.mutate(e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
              <Globe size={12} /> Internet
            </label>
          ) : null}
        </div>

        <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3" aria-live="polite">
          {material.withMaterial === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              Nenhuma aula deste curso tem transcrição, legenda, texto ou PDF ainda.{' '}
              <button type="button" onClick={onTranscribe} className="text-accent hover:underline">
                Transcrever o curso
              </button>
            </p>
          ) : (
            messages.length === 0 &&
            !pending && (
              <div className="py-2">
                <p className="mb-2 text-sm text-muted">
                  Pergunte sobre qualquer assunto do curso. A IA busca nas aulas e cita a aula e o minuto, com clique para abrir.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setDraft(s)
                        requestAnimationFrame(() => {
                          inputRef.current?.focus()
                          inputRef.current?.setSelectionRange(s.length, s.length)
                        })
                      }}
                      className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:border-accent hover:text-text"
                    >
                      {s.trim()}…
                    </button>
                  ))}
                </div>
              </div>
            )
          )}
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="ml-auto max-w-[90%] rounded-lg bg-accent-soft px-3 py-2 text-sm whitespace-pre-wrap">
                {m.content}
              </div>
            ) : (
              <div key={i} className="group">
                {m.content ? <Answer message={m} titles={lessonTitles} /> : null}
                {m.interrupted && <p className="text-xs text-muted italic">Resposta interrompida.</p>}
                <SourceLinks sources={m.sources} className="mt-2" />
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted">
                  {m.consulted && (
                    <span className="inline-flex items-center gap-1" title={m.consulted.terms.length ? `Termos buscados: ${m.consulted.terms.join(', ')}` : undefined}>
                      <Search size={12} />
                      {m.consulted.chunks ? `${plural(m.consulted.chunks, 'trecho')} de ${plural(m.consulted.lessons, 'aula')}` : 'nada encontrado nas aulas'}
                    </span>
                  )}
                  {m.content && (
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(m.content)
                        setCopied(i)
                        setTimeout(() => setCopied(null), 1500)
                      }}
                      className="inline-flex items-center gap-1 opacity-0 transition group-hover:opacity-100 hover:text-text focus-visible:opacity-100"
                    >
                      {copied === i ? <Check size={12} /> : <Copy size={12} />} Copiar
                    </button>
                  )}
                </div>
              </div>
            )
          )}
          {pending && (
            <>
              <div className="ml-auto max-w-[90%] rounded-lg bg-accent-soft px-3 py-2 text-sm whitespace-pre-wrap">{pending.question}</div>
              {pending.answer ? (
                <Answer message={{ role: 'assistant', content: pending.answer, at: 0 }} titles={lessonTitles} />
              ) : (
                <p className="inline-flex items-center gap-2 text-sm text-muted">
                  <Loader2 size={14} className="animate-spin" /> Procurando nas aulas…
                </p>
              )}
            </>
          )}
        </div>

        <form
          className="flex items-end gap-2 border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault()
            ask(draft)
          }}
        >
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                ask(draft)
              }
            }}
            maxLength={MAX_CHAT_QUESTION}
            rows={2}
            placeholder="Pergunte sobre o curso… (Enter envia)"
            aria-label="Pergunta sobre o curso"
            disabled={send.isPending || material.withMaterial === 0}
            className="min-h-12 flex-1 resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none disabled:opacity-60"
          />
          {send.isPending ? (
            <button type="button" onClick={() => window.api.ai.courseChatCancel()} className="grid size-10 place-items-center rounded-md border border-border text-muted hover:text-text" aria-label="Parar a resposta">
              <Square size={16} />
            </button>
          ) : (
            <button type="submit" disabled={!draft.trim()} className="grid size-10 place-items-center rounded-md bg-accent text-on-accent hover:brightness-110 disabled:opacity-50" aria-label="Enviar pergunta">
              <Send size={16} />
            </button>
          )}
        </form>
        <p className="px-3 pb-2 text-[11px] text-muted">A IA pode errar. Ela usa trechos das aulas (sem títulos nem nomes de arquivos){web ? ' e pode pesquisar na internet' : ''}.</p>
      </>
    )
  }

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface" aria-label="Perguntar ao curso">
      {header}
      {body}
      <ConfirmDialog open={confirmClear} title="Limpar conversa" confirmLabel="Limpar" onConfirm={() => clear.mutate()} onClose={() => setConfirmClear(false)} busy={clear.isPending}>
        Apagar todas as mensagens da conversa sobre este curso?
      </ConfirmDialog>
    </aside>
  )
}
