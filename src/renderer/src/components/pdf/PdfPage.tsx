import { memo, useEffect, useRef, useState } from 'react'
import { TextLayer, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from 'pdfjs-dist'
import { highlightFill, type PdfHighlight } from '@shared/pdf'
import { searchable } from '../../lib/pdf'

/** Distância (em px) antes de entrar na tela em que a página já começa a ser desenhada. */
const PRELOAD_MARGIN = '1200px 0px'

/**
 * Uma página do PDF: canvas (imagem), camada de texto invisível por cima (para selecionar e buscar) e os grifos.
 * Só desenha perto da área visível; longe dela, vira um espaço vazio do mesmo tamanho (economiza memória).
 */
export const PdfPage = memo(function PdfPage({ doc, number, scale, fallbackSize, highlights, query, root, selectedHighlight }: {
  doc: PDFDocumentProxy
  number: number
  scale: number
  /** Tamanho (em pontos) usado enquanto a página não carregou: o da primeira página. */
  fallbackSize: { w: number; h: number }
  highlights: PdfHighlight[]
  query: string
  root: HTMLElement | null
  selectedHighlight: number | null
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const [page, setPage] = useState<PDFPageProxy | null>(null)
  const [textReady, setTextReady] = useState(0)

  useEffect(() => {
    const el = boxRef.current
    if (!el || !root) return
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { root, rootMargin: PRELOAD_MARGIN })
    observer.observe(el)
    return () => observer.disconnect()
  }, [root])

  useEffect(() => {
    if (!near || page) return
    let alive = true
    void doc.getPage(number).then((p) => alive && setPage(p))
    return () => {
      alive = false
    }
  }, [near, page, doc, number])

  // Desenha a imagem e a camada de texto; refaz ao mudar o zoom.
  useEffect(() => {
    const canvas = canvasRef.current
    const text = textRef.current
    if (!near || !page || !canvas || !text) return
    const viewport = page.getViewport({ scale })
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.floor(viewport.width * ratio)
    canvas.height = Math.floor(viewport.height * ratio)
    canvas.style.width = `${Math.floor(viewport.width)}px`
    canvas.style.height = `${Math.floor(viewport.height)}px`
    let task: RenderTask | null = page.render({ canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined })
    task.promise.catch(() => {}).finally(() => (task = null))

    text.replaceChildren()
    const layer = new TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport })
    let alive = true
    layer
      .render()
      .then(() => alive && setTextReady((n) => n + 1))
      .catch(() => {})
    return () => {
      alive = false
      task?.cancel()
      layer.cancel()
    }
  }, [near, page, scale])

  // Longe da tela: libera a memória do canvas.
  useEffect(() => {
    if (near) return
    const canvas = canvasRef.current
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
    textRef.current?.replaceChildren()
  }, [near])

  // Marca os trechos da camada de texto que contêm a busca.
  useEffect(() => {
    const text = textRef.current
    if (!text) return
    const q = searchable(query.trim())
    for (const span of text.querySelectorAll<HTMLElement>('span')) {
      span.classList.toggle('tk-hit', q.length > 1 && searchable(span.textContent ?? '').includes(q))
    }
  }, [query, textReady])

  const size = page ? page.getViewport({ scale }) : { width: fallbackSize.w * scale, height: fallbackSize.h * scale }

  return (
    <div
      ref={boxRef}
      data-page={number}
      className="tk-pdf-page relative mx-auto bg-white shadow-md"
      style={{ width: Math.floor(size.width), height: Math.floor(size.height), ['--total-scale-factor' as string]: scale }}
    >
      <canvas ref={canvasRef} className="absolute inset-0" aria-hidden />
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {highlights.map((h) =>
          h.rects.map((r, i) => (
            <div
              key={`${h.id}-${i}`}
              data-highlight={h.id}
              className={`absolute mix-blend-multiply ${selectedHighlight === h.id ? 'outline-2 outline-accent' : ''}`}
              style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, background: highlightFill(h.color) }}
            />
          ))
        )}
      </div>
      <div ref={textRef} className="textLayer" />
      {!page && <span className="absolute inset-0 grid place-items-center text-sm text-neutral-400">Página {number}</span>}
    </div>
  )
})
