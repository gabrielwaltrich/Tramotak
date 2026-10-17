import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Globe, Loader2, NotebookPen, Send, Sparkles, Square, Trash2 } from 'lucide-react'
import { AI_PROVIDERS, clock, MAX_CHAT_QUESTION, parseClock, type ChatMessage } from '@shared/ai'
import { PAGE_REF } from '@shared/pdf'
import { errorMessage, queryKeys } from '../../lib/api'
import { renderMarkdown } from '../../lib/markdown'
import { ConfirmDialog } from '../ConfirmDialog'
import { useToast } from '../Toast'
import { aiKeysQuery, aiReady } from './AiSettings'
import { SourceLinks } from './SourceLinks'

const SUGGESTIONS = ['Resuma a aula em tópicos', 'Quais são os conceitos principais?', 'Faça 3 perguntas para eu testar o que entendi']
const NOW_SUGGESTION = 'Explique o trecho atual do vídeo'
const PAGE_SUGGESTION = 'Explique a página atual'

/**
 * Markdown da resposta com as marcas de tempo [m:ss] viradas em botões que pulam o vídeo, ou, em PDFs, as
 * páginas [p. 12] em botões que abrem a página.
 */
function answerHtml(text: string, seekable: boolean, pages: boolean): string {
  let html = renderMarkdown(text)
  if (seekable) {
    html = html.replace(/\[((?:\d+:)?\d{1,2}:\d{2})\]/g, (match, label: string) => {
      const sec = parseClock(label)
      return sec === null ? match : `<button type="button" class="tk-time" data-sec="${sec}" aria-label="Ir para ${label} no vídeo">${label}</button>`
    })
  }
  if (pages) {
    html = html.replace(PAGE_REF, (_match, page: string) => `<button type="button" class="tk-time" data-page="${Number(page)}" aria-label="Ir para a página ${Number(page)}">p. ${Number(page)}</button>`)
  }
  return html
}

function Answer({ message, seekable, onSeek, onOpenPage }: {
  message: ChatMessage
  seekable: boolean
  onSeek?: (sec: number) => void
  onOpenPage?: (page: number) => void
}) {
  const html = useMemo(() => answerHtml(message.content, seekable, Boolean(onOpenPage)), [message.content, seekable, onOpenPage])
  return (
    <div
      className="prose-tk text-sm"
      onClick={(e) => {
        const target = (e.target as HTMLElement).closest<HTMLElement>('[data-sec], [data-page]')
        if (target?.dataset.sec !== undefined && onSeek) onSeek(Number(target.dataset.sec))
        if (target?.dataset.page !== undefined && onOpenPage) onOpenPage(Number(target.dataset.page))
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export function LessonChat({ lessonId, getTime, onSeek, onOpenTranscript, getPage, onOpenPage }: {
  lessonId: number
  getTime: () => number | null
  onSeek?: (sec: number) => void
  onOpenTranscript?: () => void
  /** Aula em PDF: página aberta (vai junto da pergunta) e como abrir uma página citada na resposta. */
  getPage?: () => number | null
  onOpenPage?: (page: number) => void
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [includeNotes, setIncludeNotes] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<{ question: ChatMessage; answer: string } | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: () => window.api.settings.get(), staleTime: 0 })
  const keys = useQuery({ ...aiKeysQuery, staleTime: 0 })
  const chatKey = ['ai-chat', lessonId, includeNotes]
  const chat = useQuery({ queryKey: chatKey, queryFn: () => window.api.ai.chatGet(lessonId, includeNotes), staleTime: 0 })

  // Pedaços da resposta chegando enquanto o modelo escreve.
  useEffect(
    () =>
      window.api.ai.onChatDelta((delta) => {
        if (delta.lessonId === lessonId) setPending((p) => (p ? { ...p, answer: p.answer + delta.text } : p))
      }),
    [lessonId]
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
      const videoSec = onSeek ? getTime() : null
      const page = getPage?.() ?? null
      setPending({ question: { role: 'user', content: text, at: Date.now() / 1000, videoSec, page }, answer: '' })
      return window.api.ai.chatSend({ lessonId, text, includeNotes, webSearch: web, videoSec, page })
    },
    onSuccess: async () => {
      setDraft('')
      await queryClient.invalidateQueries({ queryKey: ['ai-chat', lessonId] })
    },
    onError: (error) => toast(errorMessage(error), 'error'),
    onSettled: () => setPending(null)
  })

  const clear = useMutation({
    mutationFn: () => window.api.ai.chatClear(lessonId),
    onSuccess: () => {
      setConfirmClear(false)
      return queryClient.invalidateQueries({ queryKey: ['ai-chat', lessonId] })
    }
  })

  const saveNote = useMutation({
    mutationFn: ({ question, answer }: { question: ChatMessage | undefined; answer: ChatMessage }) =>
      window.api.notes.create({
        lessonId,
        timestampSec: question?.videoSec ?? null,
        page: question?.page ?? null,
        body: `${question ? `> ${question.content.replace(/\n/g, '\n> ')}\n\n` : ''}${answer.content}`
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.notes(lessonId) })
      toast('Resposta salva nas anotações')
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  const ask = (text: string) => {
    const q = text.trim()
    if (q && !send.isPending) send.mutate(q)
  }

  if (!settings.data || keys.isPending || chat.isPending) return <Loader2 className="mx-auto my-6 animate-spin text-muted" />

  if (!aiReady(settings.data, keys.data)) {
    return (
      <div className="py-6 text-center text-sm text-muted">
        <Sparkles size={20} className="mx-auto mb-2 text-accent" />
        Para conversar com a IA sobre esta aula, escolha um provedor (dá para usar de graça).{' '}
        <Link to="/settings" className="text-accent hover:underline">
          Abrir Configurações
        </Link>
      </div>
    )
  }

  const material = chat.data?.material
  if (!material?.kind) {
    return (
      <div className="py-6 text-center text-sm text-muted">
        {getPage
          ? 'A IA conversa a partir do texto do PDF, e não foi possível ler texto neste arquivo (PDF escaneado, só com imagens?).'
          : 'A IA conversa a partir do que é falado na aula, e esta aula ainda não tem transcrição nem legenda.'}
        {onOpenTranscript && (
          <>
            {' '}
            <button type="button" onClick={onOpenTranscript} className="text-accent hover:underline">
              Transcrever na aba Transcrição
            </button>
          </>
        )}
      </div>
    )
  }

  const baseLabel =
    material.kind === 'transcript' ? 'transcrição' : material.kind === 'subtitle' ? 'legenda do curso' : material.kind === 'pdf' ? 'texto do PDF' : 'texto da aula'
  const truncated = info && material.chars > info.maxSourceChars

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          Base: {baseLabel}
          {truncated ? ' (cortada no limite do modelo)' : ''} · {info?.label}
        </span>
        {info?.web ? (
          <label className="flex cursor-pointer items-center gap-1.5" title={`Pesquisa: ${info.web}`}>
            <input type="checkbox" checked={web} onChange={(e) => setWeb.mutate(e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
            <Globe size={12} /> Pesquisar na internet
          </label>
        ) : null}
        {material.notes > 0 && (
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={includeNotes} onChange={(e) => setIncludeNotes(e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
            Incluir minhas anotações ({material.notes})
          </label>
        )}
        {messages.length > 0 && (
          <button type="button" onClick={() => setConfirmClear(true)} className="ml-auto inline-flex items-center gap-1 hover:text-red-400">
            <Trash2 size={12} /> Limpar conversa
          </button>
        )}
      </div>

      <div ref={listRef} className="max-h-[28rem] min-h-24 space-y-4 overflow-y-auto pr-1" aria-live="polite">
        {messages.length === 0 && !pending && (
          <div className="py-3">
            <p className="mb-2 text-sm text-muted">
              Pergunte qualquer coisa sobre o conteúdo desta aula. {onOpenPage ? 'As respostas citam a página do PDF.' : 'As respostas citam o momento do vídeo.'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[...SUGGESTIONS, ...(onSeek ? [NOW_SUGGESTION] : []), ...(onOpenPage ? [PAGE_SUGGESTION] : [])].map((s) => (
                <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:border-accent hover:text-text">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-lg bg-accent-soft px-3 py-2 text-sm whitespace-pre-wrap">
              {m.videoSec != null && <span className="mb-0.5 block text-[11px] text-muted">no vídeo em {clock(m.videoSec)}</span>}
              {m.page != null && <span className="mb-0.5 block text-[11px] text-muted">na página {m.page}</span>}
              {m.content}
            </div>
          ) : (
            <div key={i} className="group max-w-[95%]">
              {m.content ? <Answer message={m} seekable={Boolean(onSeek)} onSeek={onSeek} onOpenPage={onOpenPage} /> : null}
              {m.interrupted && <p className="text-xs text-muted italic">Resposta interrompida.</p>}
              <SourceLinks sources={m.sources} className="mt-2" />
              {m.content && (
                <div className="mt-1 flex gap-3 text-xs text-muted opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(m.content)
                      setCopied(i)
                      setTimeout(() => setCopied(null), 1500)
                    }}
                    className="inline-flex items-center gap-1 hover:text-text"
                  >
                    {copied === i ? <Check size={12} /> : <Copy size={12} />} Copiar
                  </button>
                  <button
                    type="button"
                    onClick={() => saveNote.mutate({ question: messages[i - 1]?.role === 'user' ? messages[i - 1] : undefined, answer: m })}
                    className="inline-flex items-center gap-1 hover:text-text"
                  >
                    <NotebookPen size={12} /> Salvar como anotação
                  </button>
                </div>
              )}
            </div>
          )
        )}
        {pending && (
          <>
            <div className="ml-auto max-w-[85%] rounded-lg bg-accent-soft px-3 py-2 text-sm whitespace-pre-wrap">{pending.question.content}</div>
            <div className="max-w-[95%]">
              {pending.answer ? (
                <Answer message={{ role: 'assistant', content: pending.answer, at: 0 }} seekable={Boolean(onSeek)} onSeek={onSeek} onOpenPage={onOpenPage} />
              ) : (
                <p className="inline-flex items-center gap-2 text-sm text-muted">
                  <Loader2 size={14} className="animate-spin" /> {web ? 'Lendo a aula e pesquisando…' : 'Lendo a aula…'}
                </p>
              )}
            </div>
          </>
        )}
      </div>

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          ask(draft)
        }}
      >
        <textarea
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
          placeholder="Pergunte sobre a aula… (Enter envia, Shift+Enter quebra a linha)"
          aria-label="Pergunta para a IA"
          disabled={send.isPending}
          className="min-h-12 flex-1 resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none disabled:opacity-60"
        />
        {send.isPending ? (
          <button type="button" onClick={() => window.api.ai.chatCancel()} className="grid size-10 place-items-center rounded-md border border-border text-muted hover:text-text" aria-label="Parar a resposta">
            <Square size={16} />
          </button>
        ) : (
          <button type="submit" disabled={!draft.trim()} className="grid size-10 place-items-center rounded-md bg-accent text-on-accent hover:brightness-110 disabled:opacity-50" aria-label="Enviar pergunta">
            <Send size={16} />
          </button>
        )}
      </form>
      <p className="text-[11px] text-muted">
        A IA pode errar. Ela usa {onOpenPage ? 'o texto do PDF' : 'o que é falado na aula'} (sem título, curso ou nomes de arquivos){web ? ' e pode pesquisar na internet' : ''}.
      </p>

      <ConfirmDialog open={confirmClear} title="Limpar conversa" confirmLabel="Limpar" onConfirm={() => clear.mutate()} onClose={() => setConfirmClear(false)} busy={clear.isPending}>
        Apagar todas as mensagens desta conversa? As anotações salvas a partir dela continuam.
      </ConfirmDialog>
    </div>
  )
}
