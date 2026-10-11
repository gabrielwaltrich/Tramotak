import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Check,
  CloudOff,
  FileDown,
  ImageDown,
  Link2,
  Loader2,
  Maximize,
  Minus,
  Paperclip,
  Plus,
  Redo2,
  Trash2,
  Undo2,
  X
} from 'lucide-react'
import {
  addChild,
  addSibling,
  applyLayout,
  childrenOf,
  edgePath,
  getNode,
  mapBounds,
  moveNode,
  neighbor,
  nodeHeight,
  nodeWidth,
  removeNode,
  setAttachment,
  setColor,
  setText,
  textColorFor,
  toggleCollapsed,
  visibleNodes,
  wrapLines,
  type LayoutKind,
  type MindMapData,
  type MindNode,
  type NodeAttachment
} from '@shared/mindmap'
import { errorMessage } from '../lib/api'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { Label, TextInput } from '../components/Field'
import { ResourcePicker } from '../components/notebooks/ResourceBlock'
import { mapToPngBase64 } from '../components/mindmap/exportImage'
import { useToast } from '../components/Toast'

const SAVE_DELAY_MS = 800
const HISTORY_LIMIT = 100
const COLORS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#ddd6fe', '#fed7aa']
const MIN_ZOOM = 0.25
const MAX_ZOOM = 2.5
/** Largura reservada ao painel do tópico (w-56 + margens). */
const PANEL_SPACE = 250

type Viewport = { x: number; y: number; zoom: number }
type Status = 'idle' | 'saving' | 'saved' | 'error'

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

function UrlDialog({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (a: NodeAttachment) => void }) {
  const [url, setUrl] = useState('https://')
  const valid = /^https?:\/\/\S+\.\S+/.test(url)
  return (
    <Modal open={open} onClose={onClose} title="Anexar link">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          onSave({ kind: 'url', url, title: url.replace(/^https?:\/\//, '').slice(0, 60) })
          onClose()
        }}
      >
        <div>
          <Label htmlFor="node-url">Endereço</Label>
          <TextInput id="node-url" value={url} onChange={(e) => setUrl(e.target.value)} data-autofocus />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!valid}>
            Anexar
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function NodeBox({ node, root, selected, childCount, onPointerDown, onDoubleClick, onToggle, onOpenAttachment }: {
  node: MindNode
  root: boolean
  selected: boolean
  childCount: number
  onPointerDown: (e: React.PointerEvent) => void
  onDoubleClick: () => void
  onToggle: () => void
  onOpenAttachment: () => void
}) {
  const w = nodeWidth(node)
  const h = nodeHeight(node)
  const lines = wrapLines(node)
  const fill = root ? 'var(--accent)' : (node.color ?? 'var(--surface-2)')
  const ink = root ? '#ffffff' : node.color ? textColorFor(node.color) : 'var(--text)'
  const textX = node.x + (node.attachment ? (w - 18) / 2 : w / 2)
  return (
    <g data-node-id={node.id} onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} className="cursor-pointer">
      <rect
        x={node.x}
        y={node.y}
        width={w}
        height={h}
        rx={10}
        fill={fill}
        stroke={selected ? 'var(--text)' : root ? 'transparent' : 'var(--border)'}
        strokeWidth={selected ? 2 : 1}
      />
      <text textAnchor="middle" fontSize={root ? 15 : 13} fontWeight={root ? 600 : 400} fill={ink} className="pointer-events-none select-none">
        {lines.map((line, i) => (
          <tspan key={i} x={textX} y={node.y + h / 2 + (i - (lines.length - 1) / 2) * 18 + 5}>
            {line || ' '}
          </tspan>
        ))}
      </text>
      {node.attachment && (
        <g
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onOpenAttachment()
          }}
          className="cursor-pointer"
        >
          <title>{node.attachment.title}</title>
          <circle cx={node.x + w - 16} cy={node.y + h / 2} r={9} fill={root ? 'rgb(255 255 255 / 0.2)' : 'var(--accent-soft)'} />
          <Paperclip x={node.x + w - 22} y={node.y + h / 2 - 6} size={12} color={root ? '#fff' : 'var(--accent)'} />
        </g>
      )}
      {childCount > 0 && (
        <g
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          className="cursor-pointer"
        >
          <title>{node.collapsed ? 'Expandir ramo' : 'Recolher ramo'}</title>
          <circle cx={node.x + w} cy={node.y + h / 2} r={8} fill="var(--bg)" stroke="var(--border)" />
          <text x={node.x + w} y={node.y + h / 2 + 3.5} textAnchor="middle" fontSize={node.collapsed ? 9 : 11} fill="var(--text-muted)" className="pointer-events-none">
            {node.collapsed ? childCount : '−'}
          </text>
        </g>
      )}
    </g>
  )
}

export function MindmapPage() {
  const id = Number(useParams().id)
  const doc = useQuery({ queryKey: ['mindmap', id], queryFn: () => window.api.mindmaps.get(id), staleTime: 0, gcTime: 0 })
  if (doc.isPending) return <Loader2 className="mx-auto my-20 animate-spin text-muted" />
  if (doc.isError) return <p className="p-8 text-sm text-red-400">{errorMessage(doc.error)}</p>
  return <Editor key={id} id={id} initialTitle={doc.data.title} initialData={doc.data.data} />
}

function Editor({ id, initialTitle, initialData }: { id: number; initialTitle: string; initialData: MindMapData }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const containerRef = useRef<HTMLDivElement>(null)
  const [title, setTitle] = useState(initialTitle)
  const [map, setMap] = useState(initialData)
  const [past, setPast] = useState<MindMapData[]>([])
  const [future, setFuture] = useState<MindMapData[]>([])
  const [selected, setSelected] = useState<string>(initialData.rootId)
  const [editing, setEditing] = useState<string | null>(null)
  const [draftText, setDraftText] = useState('')
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const [status, setStatus] = useState<Status>('idle')
  const [picker, setPicker] = useState(false)
  const [urlDialog, setUrlDialog] = useState(false)
  const drag = useRef<{ kind: 'node'; id: string; startX: number; startY: number; nodeX: number; nodeY: number; moved: boolean } | { kind: 'pan'; startX: number; startY: number; vx: number; vy: number } | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const latest = useRef({ title, data: map })
  useEffect(() => {
    latest.current = { title, data: map }
  })

  const save = useCallback(async () => {
    try {
      await window.api.mindmaps.save(id, latest.current)
      setStatus('saved')
      void queryClient.invalidateQueries({ queryKey: ['mindmaps'] })
    } catch (e) {
      setStatus('error')
      toast(errorMessage(e), 'error')
    }
  }, [id, queryClient, toast])

  const scheduleSave = useCallback(() => {
    setStatus('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void save(), SAVE_DELAY_MS)
  }, [save])

  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        void window.api.mindmaps.save(id, latest.current).catch(() => {})
      }
    },
    [id]
  )

  /** Toda alteração passa por aqui: entra no histórico e agenda o salvamento. */
  const commit = useCallback(
    (next: MindMapData, options: { history?: boolean } = {}) => {
      if (options.history !== false) {
        setPast((p) => [...p.slice(-HISTORY_LIMIT + 1), map])
        setFuture([])
      }
      setMap(next)
      scheduleSave()
    },
    [map, scheduleSave]
  )

  /** Mudanças de estrutura reorganizam o mapa no layout atual (nós não se sobrepõem). */
  const commitLayout = useCallback((next: MindMapData) => commit(applyLayout(next)), [commit])

  const undo = useCallback(() => {
    if (!past.length) return
    setFuture((f) => [map, ...f])
    setMap(past[past.length - 1])
    setPast((p) => p.slice(0, -1))
    scheduleSave()
  }, [past, map, scheduleSave])

  const redo = useCallback(() => {
    if (!future.length) return
    setPast((p) => [...p, map])
    setMap(future[0])
    setFuture((f) => f.slice(1))
    scheduleSave()
  }, [future, map, scheduleSave])

  const fit = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const b = mapBounds(map)
    // Área útil: a tela menos o painel do tópico à direita.
    const width = Math.max(200, el.clientWidth - PANEL_SPACE)
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((width - 80) / Math.max(b.width, 1), (el.clientHeight - 80) / Math.max(b.height, 1), 1.2)))
    setViewport({ zoom, x: width / 2 - (b.x + b.width / 2) * zoom, y: el.clientHeight / 2 - (b.y + b.height / 2) * zoom })
  }, [map])

  // Centraliza na primeira abertura.
  const fitted = useRef(false)
  useEffect(() => {
    if (!fitted.current && containerRef.current) {
      fitted.current = true
      fit()
    }
  }, [fit])

  const startEdit = useCallback(
    (nodeId: string, initial?: string) => {
      setSelected(nodeId)
      setEditing(nodeId)
      setDraftText(initial ?? getNode(map, nodeId)?.text ?? '')
    },
    [map]
  )

  const finishEdit = useCallback(() => {
    if (editing === null) return
    const node = getNode(map, editing)
    const text = draftText.trim() || node?.text || 'Tópico'
    if (node && text !== node.text) commitLayout(setText(map, editing, text))
    setEditing(null)
    containerRef.current?.focus()
  }, [editing, draftText, map, commitLayout])

  const add = useCallback(
    (kind: 'child' | 'sibling') => {
      const result = kind === 'child' ? addChild(map, selected) : addSibling(map, selected)
      commitLayout(result.map)
      startEdit(result.id, '')
    },
    [map, selected, commitLayout, startEdit]
  )

  const remove = useCallback(() => {
    if (selected === map.rootId) {
      toast('O tópico central não pode ser excluído', 'error')
      return
    }
    const parent = getNode(map, selected)?.parentId ?? map.rootId
    commitLayout(removeNode(map, selected))
    setSelected(parent)
  }, [selected, map, commitLayout, toast])

  // Atalhos do editor (fora da edição de texto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing !== null || isTyping(e.target)) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if (mod || e.altKey) return
      const go = (dir: Parameters<typeof neighbor>[2]) => {
        const next = neighbor(map, selected, dir)
        if (next) setSelected(next)
      }
      switch (e.key) {
        case 'Tab':
          add('child')
          break
        case 'Enter':
          add('sibling')
          break
        case 'F2':
          startEdit(selected)
          break
        case 'Delete':
        case 'Backspace':
          remove()
          break
        case ' ':
          commitLayout(toggleCollapsed(map, selected))
          break
        case 'ArrowLeft':
          go('parent')
          break
        case 'ArrowRight':
          go('child')
          break
        case 'ArrowUp':
          go('prev')
          break
        case 'ArrowDown':
          go('next')
          break
        default:
          // Digitar uma letra começa a editar, substituindo o texto (como numa planilha).
          if (e.key.length === 1) startEdit(selected, e.key)
          else return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, map, selected, add, remove, startEdit, commitLayout, undo, redo])

  const onWheel = (e: React.WheelEvent) => {
    const rect = containerRef.current!.getBoundingClientRect()
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    // Mantém o ponto sob o cursor parado ao dar zoom.
    setViewport({ zoom, x: px - ((px - viewport.x) / viewport.zoom) * zoom, y: py - ((py - viewport.y) / viewport.zoom) * zoom })
  }

  const zoomBy = (factor: number) => {
    const el = containerRef.current!
    const cx = el.clientWidth / 2
    const cy = el.clientHeight / 2
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.zoom * factor))
    setViewport({ zoom, x: cx - ((cx - viewport.x) / viewport.zoom) * zoom, y: cy - ((cy - viewport.y) / viewport.zoom) * zoom })
  }

  const openAttachment = (a: NodeAttachment) => {
    if (a.kind === 'url') window.open(a.url, '_blank', 'noopener')
    else navigate(a.kind === 'lesson' ? `/lesson/${a.id}` : `/courses/${a.id}`)
  }

  const nodes = useMemo(() => visibleNodes(map), [map])
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const selectedNode = getNode(map, selected)
  const editingNode = editing ? getNode(map, editing) : null
  const tool = 'grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text disabled:opacity-30'

  const exportPng = async () => {
    try {
      const content = await mapToPngBase64(map)
      const path = await window.api.files.save({ title: 'Exportar imagem', defaultName: `${title}.png`, filters: [{ name: 'Imagem PNG', extensions: ['png'] }], content, encoding: 'base64' })
      if (path) toast(`Imagem salva em ${path.split(/[\\/]/).pop()}`)
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  const exportJson = async () => {
    const path = await window.api.files
      .save({ title: 'Exportar mapa', defaultName: `${title}.json`, filters: [{ name: 'Mapa mental (JSON)', extensions: ['json'] }], content: JSON.stringify({ title, data: map }, null, 2), encoding: 'utf8' })
      .catch((e) => (toast(errorMessage(e), 'error'), null))
    if (path) toast(`Mapa salvo em ${path.split(/[\\/]/).pop()}`)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2">
        <Link to="/mindmaps" className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text" aria-label="Voltar para mapas mentais">
          <ArrowLeft size={18} />
        </Link>
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            if (e.target.value.trim()) scheduleSave()
          }}
          aria-label="Nome do mapa"
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none select-text focus-visible:outline-none"
        />
        <span className="mr-2 text-xs text-muted" aria-live="polite">
          {status === 'saving' ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" /> Salvando…
            </span>
          ) : status === 'saved' ? (
            <span className="inline-flex items-center gap-1">
              <Check size={12} /> Salvo
            </span>
          ) : status === 'error' ? (
            <span className="inline-flex items-center gap-1 text-red-400">
              <CloudOff size={12} /> Erro ao salvar
            </span>
          ) : null}
        </span>
        <button type="button" onClick={undo} disabled={!past.length} aria-label="Desfazer (Ctrl+Z)" title="Desfazer (Ctrl+Z)" className={tool}>
          <Undo2 size={16} />
        </button>
        <button type="button" onClick={redo} disabled={!future.length} aria-label="Refazer (Ctrl+Shift+Z)" title="Refazer (Ctrl+Shift+Z)" className={tool}>
          <Redo2 size={16} />
        </button>
        <span className="mx-1 h-5 w-px bg-border" />
        <select
          value={map.layout}
          onChange={(e) => {
            commit(applyLayout(map, e.target.value as LayoutKind))
            requestAnimationFrame(fit)
          }}
          aria-label="Layout"
          className="h-8 rounded-md border border-border bg-bg px-2 text-sm text-text"
        >
          <option value="tree">Árvore</option>
          <option value="org">Organograma</option>
          <option value="radial">Radial</option>
        </select>
        <Button variant="ghost" className="h-8" onClick={() => (commit(applyLayout(map)), requestAnimationFrame(fit))}>
          Organizar
        </Button>
        <span className="mx-1 h-5 w-px bg-border" />
        <button type="button" onClick={exportPng} aria-label="Exportar PNG" title="Exportar PNG" className={tool}>
          <ImageDown size={16} />
        </button>
        <button type="button" onClick={exportJson} aria-label="Exportar JSON" title="Exportar JSON" className={tool}>
          <FileDown size={16} />
        </button>
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={containerRef}
          tabIndex={0}
          aria-label="Mapa mental"
          className="absolute inset-0 overflow-hidden outline-none"
          style={{ backgroundImage: 'radial-gradient(var(--border) 1px, transparent 1px)', backgroundSize: `${20 * viewport.zoom}px ${20 * viewport.zoom}px`, backgroundPosition: `${viewport.x}px ${viewport.y}px` }}
          onWheel={onWheel}
          onPointerDown={(e) => {
            if (editing) finishEdit()
            const target = (e.target as Element).closest('[data-node-id]')
            e.currentTarget.setPointerCapture(e.pointerId)
            if (target) {
              const nodeId = target.getAttribute('data-node-id')!
              const node = getNode(map, nodeId)!
              setSelected(nodeId)
              drag.current = { kind: 'node', id: nodeId, startX: e.clientX, startY: e.clientY, nodeX: node.x, nodeY: node.y, moved: false }
            } else {
              drag.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, vx: viewport.x, vy: viewport.y }
            }
          }}
          onPointerMove={(e) => {
            const d = drag.current
            if (!d) return
            const dx = e.clientX - d.startX
            const dy = e.clientY - d.startY
            if (d.kind === 'pan') setViewport((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }))
            else if (d.moved || Math.hypot(dx, dy) > 4) {
              // Primeiro movimento real: guarda o estado anterior para o desfazer.
              if (!d.moved) {
                setPast((p) => [...p.slice(-HISTORY_LIMIT + 1), map])
                setFuture([])
                d.moved = true
              }
              setMap((m) => moveNode(m, d.id, d.nodeX + dx / viewport.zoom, d.nodeY + dy / viewport.zoom))
            }
          }}
          onPointerUp={() => {
            if (drag.current?.kind === 'node' && drag.current.moved) scheduleSave()
            drag.current = null
          }}
        >
          <svg className="absolute inset-0 h-full w-full">
            <g transform={`translate(${viewport.x},${viewport.y}) scale(${viewport.zoom})`}>
              {nodes.map((n) =>
                n.parentId && byId.has(n.parentId) ? <path key={`e-${n.id}`} d={edgePath(byId.get(n.parentId)!, n)} stroke="var(--text-muted)" strokeOpacity={0.5} strokeWidth={2} fill="none" /> : null
              )}
              {nodes.map((n) => (
                <NodeBox
                  key={n.id}
                  node={n}
                  root={n.id === map.rootId}
                  selected={n.id === selected}
                  childCount={childrenOf(map, n.id).length}
                  onPointerDown={() => {}}
                  onDoubleClick={() => startEdit(n.id)}
                  onToggle={() => commitLayout(toggleCollapsed(map, n.id))}
                  onOpenAttachment={() => n.attachment && openAttachment(n.attachment)}
                />
              ))}
            </g>
          </svg>

          {editingNode && (
            <textarea
              autoFocus
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onBlur={finishEdit}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  finishEdit()
                } else if (e.key === 'Escape') {
                  setEditing(null)
                  containerRef.current?.focus()
                } else if (e.key === 'Tab') {
                  e.preventDefault()
                  finishEdit()
                }
              }}
              aria-label="Texto do tópico"
              className="absolute resize-none rounded-[10px] border-2 border-accent bg-surface px-2 py-2 text-center text-[13px] leading-[18px] text-text outline-none select-text"
              style={{
                left: viewport.x + editingNode.x * viewport.zoom,
                top: viewport.y + editingNode.y * viewport.zoom,
                width: Math.max(nodeWidth({ text: draftText, attachment: null }), 120) * viewport.zoom,
                minHeight: nodeHeight({ text: draftText }) * viewport.zoom,
                transform: `scale(${1})`,
                fontSize: 13 * viewport.zoom
              }}
            />
          )}
        </div>

        {/* Painel do tópico selecionado */}
        {selectedNode && (
          <div className="absolute top-3 right-3 w-56 space-y-3 rounded-xl border border-border bg-surface/95 p-3 text-sm shadow-lg backdrop-blur">
            <p className="line-clamp-2 font-medium">{selectedNode.text}</p>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => add('child')} className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs hover:border-accent/50">
                <Plus size={12} /> Filho <kbd className="text-muted">Tab</kbd>
              </button>
              <button type="button" onClick={() => add('sibling')} className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs hover:border-accent/50">
                <Plus size={12} /> Irmão <kbd className="text-muted">Enter</kbd>
              </button>
              <button type="button" onClick={remove} disabled={selected === map.rootId} aria-label="Excluir tópico" className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs text-red-400 hover:border-red-400/50 disabled:opacity-30">
                <Trash2 size={12} />
              </button>
            </div>
            {selected !== map.rootId && (
              <div>
                <p className="mb-1.5 text-xs text-muted">Cor</p>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => commit(setColor(map, selected, null))} aria-label="Sem cor" aria-pressed={!selectedNode.color} className={`grid size-6 place-items-center rounded-full border-2 bg-surface-2 ${!selectedNode.color ? 'border-accent' : 'border-border'}`}>
                    <X size={10} className="text-muted" />
                  </button>
                  {COLORS.map((c) => (
                    <button key={c} type="button" onClick={() => commit(setColor(map, selected, c))} aria-label={`Cor ${c}`} aria-pressed={selectedNode.color === c} className={`size-6 rounded-full border-2 ${selectedNode.color === c ? 'border-accent' : 'border-transparent'}`} style={{ background: c }} />
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="mb-1.5 text-xs text-muted">Anexo</p>
              {selectedNode.attachment ? (
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => openAttachment(selectedNode.attachment!)} className="min-w-0 flex-1 truncate rounded-md bg-accent-soft px-2 py-1 text-left text-xs text-accent hover:brightness-125">
                    <Paperclip size={11} className="mr-1 inline" />
                    {selectedNode.attachment.title}
                  </button>
                  <button type="button" onClick={() => commit(setAttachment(map, selected, null))} aria-label="Remover anexo" className="grid size-6 place-items-center rounded text-muted hover:text-red-400">
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => setPicker(true)} className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs hover:border-accent/50">
                    <Link2 size={12} /> Aula ou curso
                  </button>
                  <button type="button" onClick={() => setUrlDialog(true)} className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs hover:border-accent/50">
                    <Link2 size={12} /> Link
                  </button>
                </div>
              )}
            </div>
            <p className="border-t border-border pt-2 text-[11px] leading-relaxed text-muted">
              Digite para renomear · F2 edita · setas navegam · Espaço recolhe · Delete exclui · arraste para mover
            </p>
          </div>
        )}

        <div className="absolute bottom-3 left-3 flex items-center gap-1 rounded-lg border border-border bg-surface/95 p-1 shadow">
          <button type="button" onClick={() => zoomBy(1 / 1.2)} aria-label="Diminuir zoom" className={tool}>
            <Minus size={16} />
          </button>
          <span className="w-12 text-center text-xs text-muted tabular-nums">{Math.round(viewport.zoom * 100)}%</span>
          <button type="button" onClick={() => zoomBy(1.2)} aria-label="Aumentar zoom" className={tool}>
            <Plus size={16} />
          </button>
          <button type="button" onClick={fit} aria-label="Ajustar à tela" title="Ajustar à tela" className={tool}>
            <Maximize size={16} />
          </button>
        </div>
      </div>

      <ResourcePicker
        open={picker}
        onClose={() => setPicker(false)}
        onPick={(r) => {
          if (r.kind === 'lesson' || r.kind === 'course') commit(setAttachment(map, selected, { kind: r.kind, id: r.id, title: r.title }))
          else toast('No mapa, anexe aulas, cursos ou links', 'error')
        }}
      />
      {urlDialog && <UrlDialog open onClose={() => setUrlDialog(false)} onSave={(a) => commit(setAttachment(map, selected, a))} />}
    </div>
  )
}
