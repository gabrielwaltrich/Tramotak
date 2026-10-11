/** Blocos de uma página de caderno. */

export interface Stroke {
  color: string
  width: number
  /** [x, y, pressão] em coordenadas do bloco (largura lógica fixa de INK_WIDTH). */
  points: [number, number, number][]
}

export type ResourceRef =
  | { kind: 'course'; id: number; title: string }
  | { kind: 'lesson'; id: number; title: string }
  | { kind: 'deck'; id: number; title: string }
  | { kind: 'bank'; id: number; title: string }

export type Block =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'ink'; strokes: Stroke[]; height: number }
  | { id: string; type: 'resource'; resource: ResourceRef }

export interface NotebookSummary {
  id: number
  title: string
  pageCount: number
  updatedAt: number
}

export interface PageSummary {
  id: number
  title: string
  position: number
}

export interface Page extends PageSummary {
  notebookId: number
  blocks: Block[]
  updatedAt: number
}

export interface NotebookDetail extends NotebookSummary {
  pages: PageSummary[]
}

/** Largura lógica do desenho: os traços são guardados nessa escala e redimensionados na tela. */
export const INK_WIDTH = 800
export const INK_MIN_HEIGHT = 120
export const INK_MAX_HEIGHT = 2400
const MAX_TEXT = 100_000
const MAX_POINTS = 200_000

const RESOURCE_KINDS = ['course', 'lesson', 'deck', 'bank'] as const

/** Valida blocos vindos da interface; descarta o que estiver malformado. */
export function validateBlocks(input: unknown): Block[] {
  if (!Array.isArray(input)) throw new Error('Conteúdo da página inválido')
  let points = 0
  const out: Block[] = []
  for (const raw of input) {
    const b = raw as Block
    const id = typeof b?.id === 'string' && b.id ? b.id.slice(0, 64) : null
    if (!id) continue
    if (b.type === 'text') {
      out.push({ id, type: 'text', text: String(b.text ?? '').slice(0, MAX_TEXT) })
    } else if (b.type === 'ink') {
      const strokes = (Array.isArray(b.strokes) ? b.strokes : [])
        .map((s) => ({
          color: typeof s.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(s.color) ? s.color : '#000000',
          width: Math.min(40, Math.max(0.5, Number(s.width) || 2)),
          points: (Array.isArray(s.points) ? s.points : [])
            .filter((p) => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite))
            .map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, Math.min(1, Math.max(0, p[2] ?? 0.5))] as [number, number, number])
        }))
        .filter((s) => s.points.length > 0)
      points += strokes.reduce((n, s) => n + s.points.length, 0)
      if (points > MAX_POINTS) throw new Error('Desenho grande demais para uma página')
      out.push({ id, type: 'ink', strokes, height: Math.min(INK_MAX_HEIGHT, Math.max(INK_MIN_HEIGHT, Math.round(Number(b.height) || 300))) })
    } else if (b.type === 'resource') {
      const r = b.resource
      if (!r || !RESOURCE_KINDS.includes(r.kind) || !Number.isInteger(r.id)) continue
      out.push({ id, type: 'resource', resource: { kind: r.kind, id: r.id, title: String(r.title ?? '').slice(0, 300) } as ResourceRef })
    }
  }
  return out
}

/** Texto da página para a busca: blocos de texto e títulos dos recursos. */
export function pagePlainText(blocks: Block[]): string {
  return blocks
    .map((b) => (b.type === 'text' ? b.text : b.type === 'resource' ? b.resource.title : ''))
    .filter(Boolean)
    .join('\n')
}
