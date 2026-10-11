import { useEffect, useRef, useState } from 'react'
import { Eraser, Minus, PenLine, Plus, Trash2 } from 'lucide-react'
import { INK_MAX_HEIGHT, INK_MIN_HEIGHT, INK_WIDTH, type Stroke } from '@shared/notebooks'

export const INK_COLORS = ['#1f2937', '#2563eb', '#dc2626', '#16a34a', '#7c3aed', '#ea580c']
const WIDTHS = [2, 4, 8]
const ERASER_RADIUS = 12
/** O "papel" é sempre claro: o desenho fica igual no tema escuro e no PDF. */
export const PAPER = '#fdfcf8'

/** Caminho suave pelos pontos médios (curvas quadráticas). */
export function strokePath(points: Stroke['points']): string {
  if (points.length === 0) return ''
  if (points.length === 1) {
    const [x, y] = points[0]
    return `M${x},${y} l0.1,0`
  }
  let d = `M${points[0][0]},${points[0][1]}`
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i]
    const [nx, ny] = points[i + 1]
    d += ` Q${x},${y} ${(x + nx) / 2},${(y + ny) / 2}`
  }
  const last = points[points.length - 1]
  return `${d} L${last[0]},${last[1]}`
}

/** Espessura pela pressão média (caneta de tablet); mouse usa 0,5. */
export function strokeWidth(stroke: Stroke): number {
  const avg = stroke.points.reduce((n, p) => n + p[2], 0) / stroke.points.length
  return stroke.width * (0.6 + avg * 0.8)
}

export function InkSvg({ strokes, height, className = '' }: { strokes: Stroke[]; height: number; className?: string }) {
  return (
    <svg viewBox={`0 0 ${INK_WIDTH} ${height}`} className={`block w-full ${className}`} style={{ background: PAPER }} role="img" aria-label="Desenho">
      {strokes.map((s, i) => (
        <path key={i} d={strokePath(s.points)} stroke={s.color} strokeWidth={strokeWidth(s)} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  )
}

export function InkBlock({ strokes, height, onChange, readOnly }: {
  strokes: Stroke[]
  height: number
  onChange: (value: { strokes: Stroke[]; height: number }) => void
  readOnly: boolean
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen')
  const [color, setColor] = useState(INK_COLORS[0])
  const [width, setWidth] = useState(WIDTHS[1])
  // O traço em andamento vive numa ref (fonte da verdade, imune ao atraso de renderização);
  // o estado só serve para desenhá-lo na tela.
  const [current, setCurrent] = useState<Stroke | null>(null)
  const stroke = useRef<Stroke | null>(null)
  const drawing = useRef(false)
  // Lista mais recente de traços: dois traços seguidos não podem partir de uma lista velha.
  const latest = useRef(strokes)
  useEffect(() => {
    latest.current = strokes
  }, [strokes])

  if (readOnly) return <InkSvg strokes={strokes} height={height} className="rounded-md border border-border" />

  const toLocal = (e: React.PointerEvent): [number, number, number] => {
    const rect = svgRef.current!.getBoundingClientRect()
    const scale = INK_WIDTH / rect.width
    const pressure = e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5
    return [(e.clientX - rect.left) * scale, (e.clientY - rect.top) * scale, pressure]
  }

  const erase = (x: number, y: number) => {
    const kept = latest.current.filter((s) => !s.points.some(([px, py]) => Math.hypot(px - x, py - y) < ERASER_RADIUS))
    if (kept.length !== latest.current.length) {
      latest.current = kept
      onChange({ strokes: kept, height })
    }
  }

  const tool_ = (active: boolean) => `grid size-8 place-items-center rounded-md ${active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-text'}`

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-surface px-2 py-1">
        <button type="button" onClick={() => setTool('pen')} aria-pressed={tool === 'pen'} aria-label="Caneta" className={tool_(tool === 'pen')}>
          <PenLine size={16} />
        </button>
        <button type="button" onClick={() => setTool('eraser')} aria-pressed={tool === 'eraser'} aria-label="Borracha" className={tool_(tool === 'eraser')}>
          <Eraser size={16} />
        </button>
        <span className="mx-1 h-5 w-px bg-border" />
        {INK_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => (setColor(c), setTool('pen'))}
            aria-label={`Cor ${c}`}
            aria-pressed={color === c && tool === 'pen'}
            className={`size-6 rounded-full border-2 ${color === c && tool === 'pen' ? 'border-accent' : 'border-transparent'}`}
            style={{ background: c }}
          />
        ))}
        <span className="mx-1 h-5 w-px bg-border" />
        {WIDTHS.map((w) => (
          <button key={w} type="button" onClick={() => setWidth(w)} aria-label={`Espessura ${w}`} aria-pressed={width === w} className={tool_(width === w)}>
            <span className="rounded-full bg-current" style={{ width: w + 2, height: w + 2 }} />
          </button>
        ))}
        <span className="flex-1" />
        <button type="button" onClick={() => onChange({ strokes, height: Math.max(INK_MIN_HEIGHT, height - 150) })} aria-label="Menos espaço" className={tool_(false)}>
          <Minus size={16} />
        </button>
        <button type="button" onClick={() => onChange({ strokes, height: Math.min(INK_MAX_HEIGHT, height + 150) })} aria-label="Mais espaço" className={tool_(false)}>
          <Plus size={16} />
        </button>
        <button type="button" onClick={() => onChange({ strokes: [], height })} aria-label="Limpar desenho" className={tool_(false)} disabled={strokes.length === 0}>
          <Trash2 size={16} />
        </button>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${INK_WIDTH} ${height}`}
        className={`block w-full touch-none ${tool === 'eraser' ? 'cursor-cell' : 'cursor-crosshair'}`}
        style={{ background: PAPER }}
        aria-label="Área de desenho"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drawing.current = true
          const p = toLocal(e)
          if (tool === 'eraser') erase(p[0], p[1])
          else {
            stroke.current = { color, width, points: [p] }
            setCurrent(stroke.current)
          }
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return
          const p = toLocal(e)
          if (tool === 'eraser') erase(p[0], p[1])
          else if (stroke.current) {
            stroke.current = { ...stroke.current, points: [...stroke.current.points, p] }
            setCurrent(stroke.current)
          }
        }}
        onPointerUp={() => {
          drawing.current = false
          const done = stroke.current
          stroke.current = null
          if (done && done.points.length) {
            latest.current = [...latest.current, done]
            onChange({ strokes: latest.current, height })
          }
          setCurrent(null)
        }}
        onPointerCancel={() => {
          drawing.current = false
          stroke.current = null
          setCurrent(null)
        }}
      >
        {[...strokes, ...(current ? [current] : [])].map((s, i) => (
          <path key={i} d={strokePath(s.points)} stroke={s.color} strokeWidth={strokeWidth(s)} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
    </div>
  )
}
