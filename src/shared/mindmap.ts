/**
 * Mapa mental como árvore: um nó raiz (central) e ramos. Todas as operações são puras:
 * recebem um mapa e devolvem outro, o que simplifica desfazer/refazer.
 */

export type LayoutKind = 'tree' | 'org' | 'radial'

export type NodeAttachment =
  | { kind: 'lesson'; id: number; title: string }
  | { kind: 'course'; id: number; title: string }
  | { kind: 'url'; url: string; title: string }

export interface MindNode {
  id: string
  parentId: string | null
  text: string
  x: number
  y: number
  color: string | null
  collapsed: boolean
  attachment: NodeAttachment | null
}

export interface MindMapData {
  version: 1
  rootId: string
  layout: LayoutKind
  nodes: MindNode[]
}

export const NODE_HEIGHT = 40
const CHAR_WIDTH = 7.5
const NODE_PADDING = 28
export const NODE_MIN_WIDTH = 80
export const NODE_MAX_WIDTH = 260
const H_GAP = 60
const V_GAP = 14
const RADIAL_STEP = 220

let counter = 0
export function newNodeId(): string {
  counter = (counter + 1) % 1_000_000
  return `n${Date.now().toString(36)}${counter.toString(36)}`
}

/** Largura estimada do nó pelo texto (o canvas usa a mesma conta para casar layout e desenho). */
export function nodeWidth(node: Pick<MindNode, 'text' | 'attachment'>): number {
  const longest = Math.max(...node.text.split('\n').map((l) => l.length), 1)
  const extra = node.attachment ? 22 : 0
  return Math.round(Math.min(NODE_MAX_WIDTH, Math.max(NODE_MIN_WIDTH, longest * CHAR_WIDTH + NODE_PADDING + extra)))
}

export function nodeHeight(node: Pick<MindNode, 'text'>): number {
  const width = nodeWidth({ text: node.text, attachment: null })
  const perLine = Math.max(1, Math.floor((width - NODE_PADDING) / CHAR_WIDTH))
  const lines = node.text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0)
  return NODE_HEIGHT + (lines - 1) * 18
}

export function createMap(rootText = 'Ideia central', id = newNodeId()): MindMapData {
  return { version: 1, rootId: id, layout: 'tree', nodes: [{ id, parentId: null, text: rootText, x: 0, y: 0, color: null, collapsed: false, attachment: null }] }
}

export function getNode(map: MindMapData, id: string): MindNode | undefined {
  return map.nodes.find((n) => n.id === id)
}

export function childrenOf(map: MindMapData, id: string): MindNode[] {
  return map.nodes.filter((n) => n.parentId === id)
}

function patchNode(map: MindMapData, id: string, patch: Partial<MindNode>): MindMapData {
  return { ...map, nodes: map.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }
}

/** Filho novo, posicionado à direita do pai e abaixo dos irmãos. */
export function addChild(map: MindMapData, parentId: string, text = 'Novo tópico', id = newNodeId()): { map: MindMapData; id: string } {
  const parent = getNode(map, parentId)
  if (!parent) throw new Error('Nó não encontrado')
  const siblings = childrenOf(map, parentId)
  const last = siblings.reduce((max, s) => Math.max(max, s.y), parent.y - NODE_HEIGHT - V_GAP)
  const node: MindNode = {
    id,
    parentId,
    text,
    x: parent.x + nodeWidth(parent) + H_GAP,
    y: siblings.length ? last + NODE_HEIGHT + V_GAP : parent.y,
    color: null,
    collapsed: false,
    attachment: null
  }
  const opened = parent.collapsed ? patchNode(map, parentId, { collapsed: false }) : map
  return { map: { ...opened, nodes: [...opened.nodes, node] }, id }
}

/** Irmão logo abaixo; na raiz, vira filho (a raiz não tem irmãos). */
export function addSibling(map: MindMapData, id: string, text = 'Novo tópico', newId = newNodeId()): { map: MindMapData; id: string } {
  const node = getNode(map, id)
  if (!node) throw new Error('Nó não encontrado')
  if (node.parentId === null) return addChild(map, id, text, newId)
  const created = addChild(map, node.parentId, text, newId)
  // Insere logo depois do irmão (a ordem no array é a ordem dos ramos).
  const nodes = created.map.nodes.filter((n) => n.id !== newId)
  const index = nodes.findIndex((n) => n.id === id)
  nodes.splice(index + 1, 0, getNode(created.map, newId)!)
  return { map: { ...created.map, nodes: nodes.map((n) => (n.id === newId ? { ...n, y: node.y + NODE_HEIGHT + V_GAP } : n)) }, id: newId }
}

export function descendants(map: MindMapData, id: string): Set<string> {
  const out = new Set<string>()
  const stack = [id]
  while (stack.length) {
    const current = stack.pop()!
    for (const child of childrenOf(map, current)) {
      out.add(child.id)
      stack.push(child.id)
    }
  }
  return out
}

/** Remove o nó e todo o ramo abaixo dele. A raiz não pode ser removida. */
export function removeNode(map: MindMapData, id: string): MindMapData {
  if (id === map.rootId) throw new Error('O tópico central não pode ser excluído')
  const gone = descendants(map, id).add(id)
  return { ...map, nodes: map.nodes.filter((n) => !gone.has(n.id)) }
}

export function setText(map: MindMapData, id: string, text: string): MindMapData {
  return patchNode(map, id, { text: text.slice(0, 500) })
}

export function setColor(map: MindMapData, id: string, color: string | null): MindMapData {
  return patchNode(map, id, { color })
}

export function setAttachment(map: MindMapData, id: string, attachment: NodeAttachment | null): MindMapData {
  return patchNode(map, id, { attachment })
}

export function toggleCollapsed(map: MindMapData, id: string): MindMapData {
  const node = getNode(map, id)
  if (!node || childrenOf(map, id).length === 0) return map
  return patchNode(map, id, { collapsed: !node.collapsed })
}

/** Move o nó; com `withBranch`, o ramo inteiro acompanha. */
export function moveNode(map: MindMapData, id: string, x: number, y: number, withBranch = true): MindMapData {
  const node = getNode(map, id)
  if (!node) return map
  const dx = x - node.x
  const dy = y - node.y
  const moving = withBranch ? descendants(map, id).add(id) : new Set([id])
  return { ...map, nodes: map.nodes.map((n) => (moving.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)) }
}

/** Nós visíveis: tudo menos o que está dentro de ramos recolhidos. */
export function visibleNodes(map: MindMapData): MindNode[] {
  const hidden = new Set<string>()
  for (const n of map.nodes) if (n.collapsed) for (const d of descendants(map, n.id)) hidden.add(d)
  return map.nodes.filter((n) => !hidden.has(n.id))
}

/** Navegação pelas setas, no sentido do layout em árvore (filhos à direita). */
export function neighbor(map: MindMapData, id: string, direction: 'parent' | 'child' | 'prev' | 'next'): string | null {
  const node = getNode(map, id)
  if (!node) return null
  if (direction === 'parent') return node.parentId
  if (direction === 'child') return node.collapsed ? null : (childrenOf(map, id)[0]?.id ?? null)
  if (node.parentId === null) return null
  const siblings = childrenOf(map, node.parentId)
  const i = siblings.findIndex((s) => s.id === id)
  return siblings[direction === 'prev' ? i - 1 : i + 1]?.id ?? null
}

// ── Layouts ─────────────────────────────────────────────────────────────────

/** "Altura" de cada ramo visível (soma das alturas das folhas), base dos layouts. */
function branchSizes(map: MindMapData, size: (n: MindNode) => number): Map<string, number> {
  const sizes = new Map<string, number>()
  const visit = (id: string): number => {
    const node = getNode(map, id)!
    const kids = node.collapsed ? [] : childrenOf(map, id)
    const own = size(node)
    const total = kids.length ? Math.max(own, kids.reduce((n, k) => n + visit(k.id), 0) + V_GAP * (kids.length - 1)) : own
    sizes.set(id, total)
    return total
  }
  visit(map.rootId)
  return sizes
}

/** Árvore horizontal: raiz à esquerda, ramos para a direita. */
function layoutTree(map: MindMapData): Map<string, { x: number; y: number }> {
  const sizes = branchSizes(map, nodeHeight)
  const out = new Map<string, { x: number; y: number }>()
  const place = (id: string, x: number, top: number) => {
    const node = getNode(map, id)!
    const size = sizes.get(id)!
    out.set(id, { x, y: top + size / 2 - nodeHeight(node) / 2 })
    if (node.collapsed) return
    const kids = childrenOf(map, id)
    const used = kids.reduce((n, k) => n + sizes.get(k.id)!, 0) + V_GAP * (kids.length - 1)
    let cursor = top + (size - used) / 2
    for (const k of kids) {
      place(k.id, x + nodeWidth(node) + H_GAP, cursor)
      cursor += sizes.get(k.id)! + V_GAP
    }
  }
  place(map.rootId, 0, 0)
  return out
}

/** Organograma: raiz no topo, ramos para baixo. */
function layoutOrg(map: MindMapData): Map<string, { x: number; y: number }> {
  const sizes = branchSizes(map, (n) => nodeWidth(n) + 10)
  const out = new Map<string, { x: number; y: number }>()
  const ROW = NODE_HEIGHT + 50
  const place = (id: string, left: number, depth: number) => {
    const node = getNode(map, id)!
    const size = sizes.get(id)!
    out.set(id, { x: left + size / 2 - nodeWidth(node) / 2, y: depth * ROW })
    if (node.collapsed) return
    const kids = childrenOf(map, id)
    const used = kids.reduce((n, k) => n + sizes.get(k.id)!, 0) + V_GAP * (kids.length - 1)
    let cursor = left + (size - used) / 2
    for (const k of kids) {
      place(k.id, cursor, depth + 1)
      cursor += sizes.get(k.id)! + V_GAP
    }
  }
  place(map.rootId, 0, 0)
  return out
}

/** Radial: raiz no centro; cada ramo ganha uma fatia do círculo proporcional ao número de folhas. */
function layoutRadial(map: MindMapData): Map<string, { x: number; y: number }> {
  const leaves = new Map<string, number>()
  const count = (id: string): number => {
    const node = getNode(map, id)!
    const kids = node.collapsed ? [] : childrenOf(map, id)
    const n = kids.length ? kids.reduce((s, k) => s + count(k.id), 0) : 1
    leaves.set(id, n)
    return n
  }
  count(map.rootId)
  const out = new Map<string, { x: number; y: number }>()
  const center = (node: MindNode, cx: number, cy: number) => ({ x: Math.round(cx - nodeWidth(node) / 2), y: Math.round(cy - nodeHeight(node) / 2) })
  const place = (id: string, depth: number, start: number, end: number) => {
    const node = getNode(map, id)!
    const angle = (start + end) / 2
    const r = depth * RADIAL_STEP
    out.set(id, center(node, Math.cos(angle) * r, Math.sin(angle) * r))
    if (node.collapsed) return
    let cursor = start
    for (const k of childrenOf(map, id)) {
      const span = ((end - start) * leaves.get(k.id)!) / leaves.get(id)!
      place(k.id, depth + 1, cursor, cursor + span)
      cursor += span
    }
  }
  place(map.rootId, 0, -Math.PI, Math.PI)
  return out
}

/** Reposiciona todos os nós visíveis no layout escolhido (os ocultos acompanham o pai). */
export function applyLayout(map: MindMapData, layout: LayoutKind = map.layout): MindMapData {
  const positions = layout === 'org' ? layoutOrg(map) : layout === 'radial' ? layoutRadial(map) : layoutTree(map)
  const nodes = map.nodes.map((n) => {
    const p = positions.get(n.id)
    return p ? { ...n, x: Math.round(p.x), y: Math.round(p.y) } : n
  })
  // Ramos recolhidos: os filhos ocultos ficam junto do pai para reaparecerem perto dele.
  const byId = new Map(nodes.map((n) => [n.id, n]))
  for (const n of nodes) {
    if (!positions.has(n.id) && n.parentId) {
      let anchor = byId.get(n.parentId)!
      while (!positions.has(anchor.id) && anchor.parentId) anchor = byId.get(anchor.parentId)!
      n.x = anchor.x + 20
      n.y = anchor.y + 20
    }
  }
  return { ...map, layout, nodes }
}

/** Valida dados vindos de arquivo/banco; recusa estruturas quebradas (ciclos, pais inexistentes). */
export function validateMap(data: unknown): MindMapData {
  const d = data as MindMapData
  if (!d || d.version !== 1 || !Array.isArray(d.nodes) || typeof d.rootId !== 'string') throw new Error('Mapa mental inválido')
  const ids = new Set<string>()
  for (const n of d.nodes) {
    if (typeof n.id !== 'string' || ids.has(n.id) || typeof n.text !== 'string') throw new Error('Mapa mental inválido')
    ids.add(n.id)
  }
  if (!ids.has(d.rootId)) throw new Error('Mapa mental sem tópico central')
  const parent = new Map(d.nodes.map((n) => [n.id, n.parentId]))
  for (const n of d.nodes) {
    if (n.id === d.rootId ? n.parentId !== null : !ids.has(n.parentId ?? '')) throw new Error('Mapa mental com ligações quebradas')
    // Sobe até a raiz; se passar de N passos, há ciclo.
    let current: string | null = n.id
    for (let steps = 0; current !== null; steps++) {
      if (steps > d.nodes.length) throw new Error('Mapa mental com ciclo')
      current = parent.get(current) ?? null
    }
  }
  const layout: LayoutKind = ['tree', 'org', 'radial'].includes(d.layout) ? d.layout : 'tree'
  return {
    version: 1,
    rootId: d.rootId,
    layout,
    nodes: d.nodes.map((n) => ({
      id: n.id,
      parentId: n.parentId,
      text: String(n.text).slice(0, 500),
      x: Number.isFinite(n.x) ? n.x : 0,
      y: Number.isFinite(n.y) ? n.y : 0,
      color: typeof n.color === 'string' ? n.color : null,
      collapsed: Boolean(n.collapsed),
      attachment: n.attachment ?? null
    }))
  }
}

/** Texto do mapa para a busca global. */
export function mapPlainText(map: MindMapData): string {
  return map.nodes.map((n) => n.text).join('\n')
}

/** Linhas do texto do nó, quebradas na mesma conta usada por `nodeHeight`. */
export function wrapLines(node: Pick<MindNode, 'text'>): string[] {
  const width = nodeWidth({ text: node.text, attachment: null })
  const perLine = Math.max(1, Math.floor((width - NODE_PADDING) / CHAR_WIDTH))
  const out: string[] = []
  for (const paragraph of node.text.split('\n')) {
    if (!paragraph) {
      out.push('')
      continue
    }
    let line = ''
    for (const word of paragraph.split(/\s+/)) {
      if (word.length > perLine) {
        if (line) out.push(line)
        for (let i = 0; i < word.length; i += perLine) out.push(word.slice(i, i + perLine))
        line = out.pop() ?? ''
      } else if ((line ? line.length + 1 : 0) + word.length > perLine) {
        out.push(line)
        line = word
      } else line = line ? `${line} ${word}` : word
    }
    out.push(line)
  }
  return out
}

/**
 * Ligação entre pai e filho: curva lateral se o filho está mais ao lado, vertical se está mais acima/abaixo.
 * Funciona nos três layouts e com nós arrastados à mão.
 */
export function edgePath(parent: MindNode, child: MindNode): string {
  const pw = nodeWidth(parent)
  const ph = nodeHeight(parent)
  const cw = nodeWidth(child)
  const ch = nodeHeight(child)
  const pcx = parent.x + pw / 2
  const pcy = parent.y + ph / 2
  const ccx = child.x + cw / 2
  const ccy = child.y + ch / 2
  if (Math.abs(ccx - pcx) >= Math.abs(ccy - pcy)) {
    const right = ccx > pcx
    const x1 = right ? parent.x + pw : parent.x
    const x2 = right ? child.x : child.x + cw
    const mx = (x1 + x2) / 2
    return `M${x1},${pcy} C${mx},${pcy} ${mx},${ccy} ${x2},${ccy}`
  }
  const down = ccy > pcy
  const y1 = down ? parent.y + ph : parent.y
  const y2 = down ? child.y : child.y + ch
  const my = (y1 + y2) / 2
  return `M${pcx},${y1} C${pcx},${my} ${ccx},${my} ${ccx},${y2}`
}

/** Retângulo que contém todos os nós visíveis. */
export function mapBounds(map: MindMapData): { x: number; y: number; width: number; height: number } {
  const nodes = visibleNodes(map)
  const xs = nodes.flatMap((n) => [n.x, n.x + nodeWidth(n)])
  const ys = nodes.flatMap((n) => [n.y, n.y + nodeHeight(n)])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

/** Texto escuro ou claro conforme a luminância da cor de fundo. */
export function textColorFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return '#111827'
  const n = parseInt(m[1], 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111827' : '#ffffff'
}
