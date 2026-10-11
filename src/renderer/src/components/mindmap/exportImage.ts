import { edgePath, mapBounds, nodeHeight, nodeWidth, textColorFor, visibleNodes, wrapLines, type MindMapData } from '@shared/mindmap'

const MARGIN = 32
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** SVG autossuficiente do mapa, em tema claro (cores fixas, sem variáveis CSS). */
export function mapToSvg(map: MindMapData): { svg: string; width: number; height: number } {
  const nodes = visibleNodes(map)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const b = mapBounds(map)
  const width = Math.ceil(b.width + MARGIN * 2)
  const height = Math.ceil(b.height + MARGIN * 2)
  const edges = nodes
    .filter((n) => n.parentId && byId.has(n.parentId))
    .map((n) => `<path d="${edgePath(byId.get(n.parentId!)!, n)}" stroke="#a1a1aa" stroke-width="2" fill="none"/>`)
    .join('')
  const boxes = nodes
    .map((n) => {
      const root = n.id === map.rootId
      const fill = root ? '#7c3aed' : (n.color ?? '#f4f4f5')
      const ink = root ? '#ffffff' : textColorFor(fill)
      const w = nodeWidth(n)
      const h = nodeHeight(n)
      const lines = wrapLines(n)
      const text = lines
        .map((line, i) => `<tspan x="${n.x + w / 2}" y="${n.y + h / 2 + (i - (lines.length - 1) / 2) * 18 + 5}">${escape(line)}</tspan>`)
        .join('')
      return `<rect x="${n.x}" y="${n.y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${root ? '#6d28d9' : '#d4d4d8'}"/><text text-anchor="middle" font-size="${root ? 15 : 13}" font-weight="${root ? 600 : 400}" fill="${ink}">${text}</text>`
    })
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${b.x - MARGIN} ${b.y - MARGIN} ${width} ${height}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"><rect x="${b.x - MARGIN}" y="${b.y - MARGIN}" width="${width}" height="${height}" fill="#ffffff"/>${edges}${boxes}</svg>`
  return { svg, width, height }
}

/** PNG (base64, sem o prefixo data:) em resolução dobrada, para ficar nítido. */
export async function mapToPngBase64(map: MindMapData, scale = 2): Promise<string> {
  const { svg, width, height } = mapToSvg(map)
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.drawImage(img, 0, 0)
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
}
