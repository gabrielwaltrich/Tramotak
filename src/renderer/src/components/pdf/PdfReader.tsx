import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, Highlighter, Loader2, MoveHorizontal, NotebookPen, Search, Trash2, ZoomIn, ZoomOut } from 'lucide-react'
import { HIGHLIGHT_COLORS, mergeRects, type HighlightColor, type PdfHighlight, type PdfRect, type PdfRef } from '@shared/pdf'
import { errorMessage, queryKeys } from '../../lib/api'
import { nextZoom, openPdf, PDF_TO_CSS, searchable } from '../../lib/pdf'
import { useToast } from '../Toast'
import { PdfPage } from './PdfPage'

/** O que a página de fora pode pedir ao leitor (ir para uma página a partir de uma anotação ou da conversa). */
export interface PdfController {
  goTo(page: number): void
  page(): number
}

type Popover =
  | { kind: 'selection'; page: number; rects: PdfRect[]; text: string; x: number; y: number }
  | { kind: 'highlight'; highlight: PdfHighlight; x: number; y: number }
  | { kind: 'note'; page: number; quote: string; highlight: { rects: PdfRect[] } | null; x: number; y: number }

const highlightsKey = (ref: PdfRef) => ['pdf-highlights', ref.lessonId, ref.assetPath] as const

/** Retângulos da seleção dentro de uma página, em fração do tamanho dela. */
function selectionRects(range: Range, pageEl: HTMLElement): PdfRect[] {
  const box = pageEl.getBoundingClientRect()
  const rects: PdfRect[] = []
  for (const r of range.getClientRects()) {
    const left = Math.max(r.left, box.left)
    const right = Math.min(r.right, box.right)
    const top = Math.max(r.top, box.top)
    const bottom = Math.min(r.bottom, box.bottom)
    if (right - left < 1 || bottom - top < 1) continue
    rects.push({ x: (left - box.left) / box.width, y: (top - box.top) / box.height, w: (right - left) / box.width, h: (bottom - top) / box.height })
  }
  return mergeRects(rects)
}

/**
 * Leitor de PDF do app: páginas em sequência, zoom, busca no texto, grifos coloridos e anotações por página.
 * O arquivo do curso nunca é alterado: grifos e notas ficam no banco.
 */
export function PdfReader({ url, pdfRef, initialPage = 1, onPageChange, onReachEnd, controllerRef, className = '' }: {
  url: string
  pdfRef: PdfRef
  initialPage?: number
  onPageChange?: (page: number, total: number) => void
  /** Chamado uma vez quando a última página aparece. */
  onReachEnd?: () => void
  controllerRef?: RefObject<PdfController | null>
  className?: string
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [base, setBase] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [fit, setFit] = useState(true)
  const [current, setCurrent] = useState(Math.max(1, initialPage))
  const [pageInput, setPageInput] = useState(String(Math.max(1, initialPage)))
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<number[] | null>(null)
  const [popover, setPopover] = useState<Popover | null>(null)
  const [noteText, setNoteText] = useState('')
  const pageTexts = useRef<Map<number, string>>(new Map())
  const reachedEnd = useRef(false)
  const anchor = useRef<{ page: number; offset: number } | null>(null)

  const highlights = useQuery({
    queryKey: highlightsKey(pdfRef),
    queryFn: () => window.api.pdf.highlights(pdfRef.lessonId, pdfRef.assetPath)
  })
  const byPage = useMemo(() => {
    const map = new Map<number, PdfHighlight[]>()
    for (const h of highlights.data ?? []) map.set(h.page, [...(map.get(h.page) ?? []), h])
    return map
  }, [highlights.data])

  // Abre o documento.
  useEffect(() => {
    const task = openPdf(url)
    let alive = true
    task.promise
      .then(async (d) => {
        const first = await d.getPage(1)
        const vp = first.getViewport({ scale: 1 })
        if (!alive) return
        setBase({ w: vp.width, h: vp.height })
        setDoc(d)
      })
      .catch((e) => alive && setError(errorMessage(e)))
    return () => {
      alive = false
      void task.destroy()
    }
  }, [url])

  const total = doc?.numPages ?? 0
  const scale = zoom * PDF_TO_CSS

  // Ajustar à largura: recalcula quando o leitor muda de tamanho.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !base || !fit) return
    const apply = () => setZoom(Math.min(3, Math.max(0.3, (el.clientWidth - 40) / (base.w * PDF_TO_CSS))))
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(el)
    return () => observer.disconnect()
  }, [base, fit])

  const pageEl = useCallback((n: number) => scrollRef.current?.querySelector<HTMLElement>(`[data-page="${n}"]`) ?? null, [])

  const goTo = useCallback(
    (n: number) => {
      const target = pageEl(Math.min(Math.max(1, n), total || 1))
      const el = scrollRef.current
      if (target && el) el.scrollTop = target.offsetTop - 12
    },
    [pageEl, total]
  )

  // Abre na página pedida (última lida ou a da anotação).
  const opened = useRef(false)
  useLayoutEffect(() => {
    if (!doc || opened.current) return
    opened.current = true
    goTo(initialPage)
  }, [doc, goTo, initialPage])

  // Mudou o zoom: mantém o mesmo ponto da mesma página na tela.
  useLayoutEffect(() => {
    const a = anchor.current
    const el = scrollRef.current
    const target = a && pageEl(a.page)
    if (a && el && target) el.scrollTop = target.offsetTop + a.offset * target.offsetHeight - 12
    anchor.current = null
  }, [scale, pageEl])

  const changeZoom = (next: number, keepFit = false) => {
    const el = scrollRef.current
    const target = pageEl(current)
    if (el && target) anchor.current = { page: current, offset: Math.max(0, (el.scrollTop + 12 - target.offsetTop) / target.offsetHeight) }
    setFit(keepFit)
    if (!keepFit) setZoom(next)
  }

  // Página atual: a que ocupa o terço de cima da área visível.
  const onScroll = () => {
    const el = scrollRef.current
    if (!el || !total) return
    const line = el.scrollTop + el.clientHeight * 0.35
    let page = 1
    for (const node of el.querySelectorAll<HTMLElement>('[data-page]')) {
      if (node.offsetTop <= line) page = Number(node.dataset.page)
      else break
    }
    if (page !== current) {
      setCurrent(page)
      setPageInput(String(page))
    }
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4
    if ((page === total || atBottom) && !reachedEnd.current && opened.current) {
      reachedEnd.current = true
      onReachEnd?.()
    }
    if (popover) setPopover(null)
  }

  useEffect(() => {
    if (total) onPageChange?.(current, total)
  }, [current, total, onPageChange])

  useEffect(() => {
    if (!controllerRef) return
    controllerRef.current = { goTo, page: () => current }
  }, [controllerRef, goTo, current])

  // ── Busca ──
  const pageText = useCallback(
    async (n: number) => {
      const cached = pageTexts.current.get(n)
      if (cached !== undefined || !doc) return cached ?? ''
      const content = await (await doc.getPage(n)).getTextContent()
      const text = searchable(content.items.map((i) => ('str' in i ? i.str : '')).join(' '))
      pageTexts.current.set(n, text)
      return text
    },
    [doc]
  )

  const runSearch = async (dir: 1 | -1) => {
    const q = searchable(query.trim())
    if (!doc || q.length < 2) return
    let list = hits
    if (!list) {
      list = []
      for (let n = 1; n <= total; n++) if ((await pageText(n)).includes(q)) list.push(n)
      setHits(list)
    }
    if (!list.length) return
    const next = dir > 0 ? (list.find((n) => n > current) ?? list[0]) : ([...list].reverse().find((n) => n < current) ?? list.at(-1)!)
    goTo(next)
  }

  // ── Seleção, grifos e anotações ──
  // Canto esquerdo do menu: um pouco antes do ponto, sempre dentro da área visível (menu e caixa têm até ~340 px).
  const position = (clientX: number, clientY: number) => {
    const el = scrollRef.current!
    const box = el.getBoundingClientRect()
    const x = clientX - box.left + el.scrollLeft - 120
    return { x: Math.max(el.scrollLeft + 8, Math.min(x, el.scrollLeft + el.clientWidth - 348)), y: clientY - box.top + el.scrollTop }
  }

  const onMouseUp = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-popover]')) return
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed && selection.rangeCount) {
      const range = selection.getRangeAt(0)
      const pageNode = (range.startContainer.parentElement ?? null)?.closest<HTMLElement>('[data-page]')
      if (!pageNode || !scrollRef.current?.contains(pageNode)) return
      const rects = selectionRects(range, pageNode)
      const text = selection.toString().replace(/\s+/g, ' ').trim()
      if (!rects.length || !text) return
      const last = range.getClientRects()[range.getClientRects().length - 1]
      setPopover({ kind: 'selection', page: Number(pageNode.dataset.page), rects, text, ...position(last?.right ?? e.clientX, last?.bottom ?? e.clientY) })
      return
    }
    // Clique sem seleção: em cima de um grifo, abre as opções dele.
    const pageNode = (e.target as HTMLElement).closest<HTMLElement>('[data-page]')
    if (!pageNode) return setPopover(null)
    const box = pageNode.getBoundingClientRect()
    const fx = (e.clientX - box.left) / box.width
    const fy = (e.clientY - box.top) / box.height
    const hit = (byPage.get(Number(pageNode.dataset.page)) ?? []).find((h) => h.rects.some((r) => fx >= r.x && fx <= r.x + r.w && fy >= r.y && fy <= r.y + r.h))
    setPopover(hit ? { kind: 'highlight', highlight: hit, ...position(e.clientX, e.clientY) } : null)
  }

  const refreshHighlights = () => queryClient.invalidateQueries({ queryKey: highlightsKey(pdfRef) })

  const addHighlight = async (page: number, rects: PdfRect[], text: string, color: HighlightColor) => {
    try {
      await window.api.pdf.createHighlight({ ...pdfRef, page, rects, text, color })
      window.getSelection()?.removeAllRanges()
      await refreshHighlights()
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  const saveNote = async () => {
    if (popover?.kind !== 'note') return
    const comment = noteText.trim()
    const quote = popover.quote ? `> ${popover.quote.replace(/\n/g, '\n> ')}` : ''
    const body = [quote, comment].filter(Boolean).join('\n\n')
    if (!body) return
    try {
      if (popover.highlight) await window.api.pdf.createHighlight({ ...pdfRef, page: popover.page, rects: popover.highlight.rects, text: popover.quote, color: 'yellow' })
      await window.api.notes.create({ lessonId: pdfRef.lessonId, timestampSec: null, page: popover.page, assetPath: pdfRef.assetPath, body })
      window.getSelection()?.removeAllRanges()
      setPopover(null)
      setNoteText('')
      await Promise.all([refreshHighlights(), queryClient.invalidateQueries({ queryKey: queryKeys.notes(pdfRef.lessonId) })])
      toast(`Anotação salva na página ${popover.page}`)
    } catch (error) {
      toast(errorMessage(error), 'error')
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const typing = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      document.getElementById(`pdf-search-${pdfRef.lessonId}`)?.focus()
    } else if (!typing && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      goTo(current + (e.key === 'ArrowRight' ? 1 : -1))
    } else if (e.key === 'Escape' && popover) {
      e.stopPropagation()
      setPopover(null)
    }
  }

  if (error) return <p className="rounded-xl border border-border bg-surface p-6 text-sm text-red-400">Não foi possível abrir o PDF: {error}</p>

  const btn = 'grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40'

  return (
    <div className={`flex flex-col overflow-hidden rounded-xl border border-border bg-surface ${className}`} onKeyDown={onKeyDown}>
      <div role="toolbar" aria-label="Leitor de PDF" className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5 text-sm">
        <button type="button" className={btn} onClick={() => goTo(current - 1)} disabled={current <= 1} aria-label="Página anterior">
          <ChevronLeft size={16} />
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const n = Number(pageInput)
            if (Number.isInteger(n)) goTo(n)
          }}
          className="flex items-center gap-1"
        >
          <input
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
            onBlur={() => setPageInput(String(current))}
            aria-label="Página"
            className="h-7 w-12 rounded border border-border bg-bg px-1 text-center tabular-nums"
          />
          <span className="text-muted tabular-nums">de {total || '…'}</span>
        </form>
        <button type="button" className={btn} onClick={() => goTo(current + 1)} disabled={!total || current >= total} aria-label="Próxima página">
          <ChevronRight size={16} />
        </button>

        <span className="mx-1 h-5 w-px bg-border" />
        <button type="button" className={btn} onClick={() => changeZoom(nextZoom(zoom, -1))} aria-label="Diminuir zoom">
          <ZoomOut size={16} />
        </button>
        <span className="w-12 text-center text-muted tabular-nums">{Math.round(zoom * 100)}%</span>
        <button type="button" className={btn} onClick={() => changeZoom(nextZoom(zoom, 1))} aria-label="Aumentar zoom">
          <ZoomIn size={16} />
        </button>
        <button type="button" className={`${btn} ${fit ? 'text-accent' : ''}`} onClick={() => changeZoom(zoom, true)} aria-label="Ajustar à largura" aria-pressed={fit}>
          <MoveHorizontal size={16} />
        </button>

        <form
          className="ml-auto flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            void runSearch(1)
          }}
        >
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted" />
            <input
              id={`pdf-search-${pdfRef.lessonId}`}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setHits(null)
              }}
              placeholder="Buscar no PDF"
              aria-label="Buscar no PDF"
              className="h-7 w-44 rounded border border-border bg-bg pr-2 pl-7"
            />
          </div>
          <button type="button" className={btn} onClick={() => void runSearch(-1)} disabled={query.trim().length < 2} aria-label="Resultado anterior">
            <ChevronUp size={16} />
          </button>
          <button type="submit" className={btn} disabled={query.trim().length < 2} aria-label="Próximo resultado">
            <ChevronDown size={16} />
          </button>
          {hits && (
            <span className="text-xs text-muted" role="status">
              {hits.length ? `${hits.length} ${hits.length === 1 ? 'página' : 'páginas'}` : 'Nada encontrado'}
            </span>
          )}
        </form>
      </div>

      <div
        ref={(el) => {
          scrollRef.current = el
          setRoot(el)
        }}
        onScroll={onScroll}
        onMouseUp={onMouseUp}
        onWheel={(e) => {
          if (!e.ctrlKey) return
          e.preventDefault()
          changeZoom(nextZoom(zoom, e.deltaY < 0 ? 1 : -1))
        }}
        tabIndex={0}
        aria-label="Páginas do PDF"
        className="tk-pdf relative min-h-0 flex-1 overflow-auto bg-surface-2 p-4 outline-none"
      >
        {!doc || !base ? (
          <Loader2 className="mx-auto my-16 animate-spin text-muted" />
        ) : (
          <div className="flex flex-col gap-4">
            {Array.from({ length: total }, (_, i) => (
              <PdfPage
                key={i + 1}
                doc={doc}
                number={i + 1}
                scale={scale}
                fallbackSize={base}
                highlights={byPage.get(i + 1) ?? []}
                query={query}
                root={root}
                selectedHighlight={popover?.kind === 'highlight' ? popover.highlight.id : null}
              />
            ))}
          </div>
        )}

        {popover && (
          <div
            data-popover
            className="absolute z-20 rounded-lg border border-border bg-surface p-1.5 text-sm text-text shadow-xl"
            style={{ left: popover.x, top: popover.y + 8 }}
            // Os botões não podem tirar a seleção do texto; no campo da anotação, o clique precisa focar.
            onMouseDown={(e) => popover.kind !== 'note' && e.preventDefault()}
          >
            {popover.kind === 'selection' && (
              <div className="flex items-center gap-1">
                <Highlighter size={14} className="mx-1 text-muted" />
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      void addHighlight(popover.page, popover.rects, popover.text, c.id)
                      setPopover(null)
                    }}
                    aria-label={`Grifar em ${c.label.toLowerCase()}`}
                    className="size-6 rounded-full border border-border"
                    style={{ background: c.swatch }}
                  />
                ))}
                <span className="mx-1 h-5 w-px bg-border" />
                <button
                  type="button"
                  onClick={() => setPopover({ kind: 'note', page: popover.page, quote: popover.text, highlight: { rects: popover.rects }, x: popover.x, y: popover.y })}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-surface-2"
                >
                  <NotebookPen size={14} /> Anotar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(popover.text)
                    setPopover(null)
                  }}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-surface-2"
                >
                  <Copy size={14} /> Copiar
                </button>
              </div>
            )}

            {popover.kind === 'highlight' && (
              <div className="flex items-center gap-1">
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={async () => {
                      await window.api.pdf.setHighlightColor(popover.highlight.id, c.id).catch((e) => toast(errorMessage(e), 'error'))
                      setPopover(null)
                      void refreshHighlights()
                    }}
                    aria-label={`Mudar para ${c.label.toLowerCase()}`}
                    aria-pressed={popover.highlight.color === c.id}
                    className={`size-6 rounded-full border ${popover.highlight.color === c.id ? 'border-text' : 'border-border'}`}
                    style={{ background: c.swatch }}
                  />
                ))}
                <span className="mx-1 h-5 w-px bg-border" />
                <button
                  type="button"
                  onClick={() => setPopover({ kind: 'note', page: popover.highlight.page, quote: popover.highlight.text, highlight: null, x: popover.x, y: popover.y })}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-surface-2"
                >
                  <NotebookPen size={14} /> Anotar
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await window.api.pdf.deleteHighlight(popover.highlight.id).catch((e) => toast(errorMessage(e), 'error'))
                    setPopover(null)
                    void refreshHighlights()
                  }}
                  className="inline-flex items-center gap-1 rounded px-2 py-1 text-red-400 hover:bg-red-500/10"
                >
                  <Trash2 size={14} /> Remover grifo
                </button>
              </div>
            )}

            {popover.kind === 'note' && (
              <div className="w-80 space-y-2 p-1">
                <p className="text-xs text-muted">Anotação na página {popover.page}</p>
                {popover.quote && <blockquote className="max-h-24 overflow-y-auto border-l-2 border-accent pl-2 text-xs text-muted">{popover.quote}</blockquote>}
                <textarea
                  autoFocus
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void saveNote()
                  }}
                  rows={3}
                  placeholder="Seu comentário (opcional)"
                  aria-label="Comentário da anotação"
                  className="w-full resize-y rounded-md border border-border bg-bg px-2 py-1.5 text-sm"
                />
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setPopover(null)} className="rounded-md px-3 py-1 text-muted hover:text-text">
                    Cancelar
                  </button>
                  <button type="button" onClick={() => void saveNote()} className="rounded-md bg-accent px-3 py-1 font-medium text-on-accent hover:brightness-110">
                    Salvar anotação
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
