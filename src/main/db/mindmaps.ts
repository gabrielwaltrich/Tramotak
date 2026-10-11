import { applyLayout, createMap, mapPlainText, validateMap, type MindMapData } from '@shared/mindmap'
import type { Database } from './database'

export interface MindMapSummary {
  id: number
  title: string
  nodeCount: number
  updatedAt: number
}

export interface MindMapDoc extends MindMapSummary {
  data: MindMapData
}

function cleanTitle(value: unknown): string {
  const title = String(value ?? '').trim()
  if (!title) throw new Error('O nome do mapa não pode ficar vazio')
  return title.slice(0, 200)
}

export function listMindMaps(db: Database): MindMapSummary[] {
  const rows = db.prepare('SELECT id, title, data_json AS data, updated_at AS updatedAt FROM mindmaps ORDER BY updated_at DESC, id DESC').all() as {
    id: number
    title: string
    data: string
    updatedAt: number
  }[]
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt, nodeCount: (JSON.parse(r.data) as MindMapData).nodes.length }))
}

export function getMindMap(db: Database, id: number): MindMapDoc {
  const row = db.prepare('SELECT id, title, data_json AS data, updated_at AS updatedAt FROM mindmaps WHERE id = ?').get(id) as
    | { id: number; title: string; data: string; updatedAt: number }
    | undefined
  if (!row) throw new Error('Mapa mental não encontrado')
  const data = JSON.parse(row.data) as MindMapData
  return { id: row.id, title: row.title, updatedAt: row.updatedAt, nodeCount: data.nodes.length, data }
}

/** Cria com o tópico central igual ao título (ou com os dados de um arquivo importado). */
export function createMindMap(db: Database, title: string, data?: unknown): number {
  const map = data === undefined ? applyLayout(createMap(cleanTitle(title))) : validateMap(data)
  const { lastInsertRowid } = db
    .prepare('INSERT INTO mindmaps (title, data_json, plain_text) VALUES (?, ?, ?)')
    .run(cleanTitle(title), JSON.stringify(map), mapPlainText(map))
  return Number(lastInsertRowid)
}

export function saveMindMap(db: Database, id: number, input: { title: string; data: unknown }, now = Math.floor(Date.now() / 1000)): number {
  const map = validateMap(input.data)
  const { changes } = db
    .prepare('UPDATE mindmaps SET title = ?, data_json = ?, plain_text = ?, updated_at = ? WHERE id = ?')
    .run(cleanTitle(input.title), JSON.stringify(map), mapPlainText(map), now, id)
  if (!changes) throw new Error('Mapa mental não encontrado')
  return now
}

export function deleteMindMap(db: Database, id: number): void {
  db.prepare('DELETE FROM mindmaps WHERE id = ?').run(id)
}
