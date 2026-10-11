import { describe, expect, it } from 'vitest'
import {
  addChild,
  addSibling,
  applyLayout,
  childrenOf,
  createMap,
  descendants,
  getNode,
  moveNode,
  neighbor,
  nodeHeight,
  nodeWidth,
  removeNode,
  setText,
  toggleCollapsed,
  validateMap,
  visibleNodes,
  type MindMapData
} from '@shared/mindmap'

/** Raiz → A (A1, A2), B. */
function sample(): MindMapData {
  let map = createMap('Cálculo', 'root')
  map = addChild(map, 'root', 'A', 'a').map
  map = addChild(map, 'a', 'A1', 'a1').map
  map = addChild(map, 'a', 'A2', 'a2').map
  map = addChild(map, 'root', 'B', 'b').map
  return map
}

const overlaps = (map: MindMapData) => {
  const boxes = visibleNodes(map).map((n) => ({ id: n.id, x: n.x, y: n.y, w: nodeWidth(n), h: nodeHeight(n) }))
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return `${a.id}×${b.id}`
    }
  return null
}

describe('operações na árvore', () => {
  it('filhos e irmãos na ordem certa', () => {
    const map = sample()
    expect(childrenOf(map, 'root').map((n) => n.text)).toEqual(['A', 'B'])
    const withSibling = addSibling(map, 'a1', 'A1.5', 'x').map
    expect(childrenOf(withSibling, 'a').map((n) => n.text)).toEqual(['A1', 'A1.5', 'A2'])
    // Irmão da raiz vira filho
    expect(getNode(addSibling(map, 'root', 'C', 'c').map, 'c')?.parentId).toBe('root')
  })

  it('remover leva o ramo junto; a raiz não sai', () => {
    const map = removeNode(sample(), 'a')
    expect(map.nodes.map((n) => n.id).sort()).toEqual(['b', 'root'])
    expect(() => removeNode(map, 'root')).toThrow('central')
  })

  it('recolher esconde o ramo; adicionar filho reabre', () => {
    let map = toggleCollapsed(sample(), 'a')
    expect(visibleNodes(map).map((n) => n.id).sort()).toEqual(['a', 'b', 'root'])
    expect(toggleCollapsed(map, 'b')).toBe(map) // sem filhos: nada muda
    map = addChild(map, 'a', 'A3', 'a3').map
    expect(getNode(map, 'a')?.collapsed).toBe(false)
  })

  it('mover leva o ramo; navegação pelas setas', () => {
    const map = sample()
    const moved = moveNode(map, 'a', getNode(map, 'a')!.x + 100, getNode(map, 'a')!.y + 50)
    expect(getNode(moved, 'a1')!.x - getNode(map, 'a1')!.x).toBe(100)
    expect(getNode(moved, 'b')!.x).toBe(getNode(map, 'b')!.x)
    expect(neighbor(map, 'a', 'child')).toBe('a1')
    expect(neighbor(map, 'a1', 'next')).toBe('a2')
    expect(neighbor(map, 'a2', 'next')).toBeNull()
    expect(neighbor(map, 'a1', 'parent')).toBe('a')
    expect([...descendants(map, 'root')].sort()).toEqual(['a', 'a1', 'a2', 'b'])
  })

  it('não altera o mapa original', () => {
    const map = sample()
    const copy = JSON.stringify(map)
    setText(map, 'a', 'mudou')
    addChild(map, 'b')
    removeNode(map, 'a')
    expect(JSON.stringify(map)).toBe(copy)
  })

  it('largura cresce com o texto, dentro dos limites', () => {
    expect(nodeWidth({ text: 'oi', attachment: null })).toBe(80)
    expect(nodeWidth({ text: 'x'.repeat(200), attachment: null })).toBe(260)
    expect(nodeHeight({ text: 'linha 1\nlinha 2' })).toBeGreaterThan(nodeHeight({ text: 'uma linha' }))
  })
})

describe('layouts', () => {
  it.each(['tree', 'org', 'radial'] as const)('%s: nenhum nó visível se sobrepõe', (layout) => {
    let map = sample()
    for (let i = 0; i < 6; i++) map = addChild(map, 'b', `B${i} com um texto um pouco maior`).map
    expect(overlaps(applyLayout(map, layout))).toBeNull()
  })

  it('árvore: filhos à direita do pai; organograma: filhos abaixo', () => {
    const tree = applyLayout(sample(), 'tree')
    expect(getNode(tree, 'a1')!.x).toBeGreaterThan(getNode(tree, 'a')!.x)
    const org = applyLayout(sample(), 'org')
    expect(getNode(org, 'a1')!.y).toBeGreaterThan(getNode(org, 'a')!.y)
    expect(org.layout).toBe('org')
  })

  it('radial: raiz no centro, primeiro nível à mesma distância', () => {
    const map = applyLayout(sample(), 'radial')
    const center = (id: string) => {
      const n = getNode(map, id)!
      return [n.x + nodeWidth(n) / 2, n.y + nodeHeight(n) / 2]
    }
    const [rx, ry] = center('root')
    expect(Math.abs(rx) + Math.abs(ry)).toBeLessThan(1)
    const dist = (id: string) => Math.hypot(center(id)[0] - rx, center(id)[1] - ry)
    expect(Math.abs(dist('a') - dist('b'))).toBeLessThan(2) // posições arredondadas ao pixel
  })

  it('ramo recolhido fica junto do pai', () => {
    const map = applyLayout(toggleCollapsed(sample(), 'a'), 'tree')
    expect(getNode(map, 'a1')!.x).toBe(getNode(map, 'a')!.x + 20)
  })
})

describe('validateMap', () => {
  it('aceita mapa válido e recusa quebrados', () => {
    expect(validateMap(JSON.parse(JSON.stringify(sample()))).nodes).toHaveLength(5)
    const broken = sample()
    expect(() => validateMap({ ...broken, rootId: 'zzz' })).toThrow('central')
    expect(() => validateMap({ ...broken, nodes: broken.nodes.map((n) => (n.id === 'a1' ? { ...n, parentId: 'nada' } : n)) })).toThrow('quebradas')
    expect(() => validateMap({ ...broken, nodes: broken.nodes.map((n) => (n.id === 'a' ? { ...n, parentId: 'a1' } : n)) })).toThrow('ciclo')
    expect(() => validateMap({ version: 2 })).toThrow('inválido')
  })
})

import { edgePath, mapBounds, textColorFor, wrapLines } from '@shared/mindmap'

describe('desenho', () => {
  it('quebra o texto em linhas que cabem no nó (e bate com a altura)', () => {
    const node = { text: 'Uma ideia bem comprida que certamente não cabe numa linha só do nó' }
    const lines = wrapLines(node)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join(' ')).toBe(node.text)
    expect(nodeHeight(node)).toBe(40 + (lines.length - 1) * 18)
    expect(wrapLines({ text: 'a\n\nb' })).toEqual(['a', '', 'b'])
  })

  it('ligação lateral ou vertical conforme a posição do filho', () => {
    const map = sample()
    const tree = applyLayout(map, 'tree')
    expect(edgePath(getNode(tree, 'root')!, getNode(tree, 'a')!)).toMatch(/^M\d+(\.\d+)?,-?\d+(\.\d+)? C/)
    const org = applyLayout(map, 'org')
    const root = getNode(org, 'root')!
    // No organograma, a ligação sai da base do pai
    expect(edgePath(root, getNode(org, 'a')!).startsWith(`M${root.x + nodeWidth(root) / 2},${root.y + nodeHeight(root)}`)).toBe(true)
  })

  it('limites do mapa e contraste do texto', () => {
    const b = mapBounds(applyLayout(sample(), 'tree'))
    expect(b.width).toBeGreaterThan(0)
    expect(b.height).toBeGreaterThan(0)
    expect(textColorFor('#ffffff')).toBe('#111827')
    expect(textColorFor('#1e3a8a')).toBe('#ffffff')
  })
})
