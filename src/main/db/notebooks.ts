import { pagePlainText, validateBlocks, type Block, type NotebookDetail, type NotebookSummary, type Page, type PageSummary } from '@shared/notebooks'
import { transaction, type Database } from './database'

function cleanTitle(value: unknown, fallback?: string): string {
  const title = String(value ?? '').trim()
  if (!title && fallback === undefined) throw new Error('O nome do caderno não pode ficar vazio')
  return (title || fallback!).slice(0, 200)
}

const touch = (db: Database, notebookId: number) => db.prepare('UPDATE notebooks SET updated_at = unixepoch() WHERE id = ?').run(notebookId)

export function listNotebooks(db: Database): NotebookSummary[] {
  return db
    .prepare(
      `SELECT n.id, n.title, n.updated_at AS updatedAt, (SELECT COUNT(*) FROM notebook_pages p WHERE p.notebook_id = n.id) AS pageCount
         FROM notebooks n ORDER BY n.updated_at DESC, n.id DESC`
    )
    .all() as unknown as NotebookSummary[]
}

export function getNotebook(db: Database, id: number): NotebookDetail {
  const notebook = listNotebooks(db).find((n) => n.id === id)
  if (!notebook) throw new Error('Caderno não encontrado')
  const pages = db
    .prepare('SELECT id, title, position FROM notebook_pages WHERE notebook_id = ? ORDER BY position, id')
    .all(id) as unknown as PageSummary[]
  return { ...notebook, pages }
}

/** Cria o caderno já com uma página em branco. */
export function createNotebook(db: Database, title: string): number {
  return transaction(db, () => {
    const id = Number(db.prepare('INSERT INTO notebooks (title) VALUES (?)').run(cleanTitle(title)).lastInsertRowid)
    db.prepare("INSERT INTO notebook_pages (notebook_id, title, position, blocks_json) VALUES (?, 'Página 1', 0, ?)").run(
      id,
      JSON.stringify([{ id: 'b1', type: 'text', text: '' }])
    )
    return id
  })
}

export function renameNotebook(db: Database, id: number, title: string): void {
  const { changes } = db.prepare('UPDATE notebooks SET title = ?, updated_at = unixepoch() WHERE id = ?').run(cleanTitle(title), id)
  if (!changes) throw new Error('Caderno não encontrado')
}

export function deleteNotebook(db: Database, id: number): void {
  db.prepare('DELETE FROM notebooks WHERE id = ?').run(id)
}

interface PageRow {
  id: number
  notebookId: number
  title: string
  position: number
  blocks: string
  updatedAt: number
}

const PAGE_SELECT = 'SELECT id, notebook_id AS notebookId, title, position, blocks_json AS blocks, updated_at AS updatedAt FROM notebook_pages'

export function getPage(db: Database, id: number): Page {
  const row = db.prepare(`${PAGE_SELECT} WHERE id = ?`).get(id) as unknown as PageRow | undefined
  if (!row) throw new Error('Página não encontrada')
  return { ...row, blocks: JSON.parse(row.blocks) as Block[] }
}

/** Todas as páginas com conteúdo, para o modo leitura e a exportação em PDF. */
export function notebookPages(db: Database, notebookId: number): Page[] {
  getNotebook(db, notebookId)
  return (db.prepare(`${PAGE_SELECT} WHERE notebook_id = ? ORDER BY position, id`).all(notebookId) as unknown as PageRow[]).map((r) => ({
    ...r,
    blocks: JSON.parse(r.blocks) as Block[]
  }))
}

export function createPage(db: Database, notebookId: number, title?: string): Page {
  const count = getNotebook(db, notebookId).pages.length
  const { lastInsertRowid } = db
    .prepare('INSERT INTO notebook_pages (notebook_id, title, position, blocks_json) VALUES (?, ?, ?, ?)')
    .run(notebookId, cleanTitle(title, `Página ${count + 1}`), count, JSON.stringify([{ id: 'b1', type: 'text', text: '' }]))
  touch(db, notebookId)
  return getPage(db, Number(lastInsertRowid))
}

/** Salva título e blocos (o salvamento automático chama isto). Devolve a data gravada. */
export function savePage(db: Database, id: number, input: { title: string; blocks: unknown }, now = Math.floor(Date.now() / 1000)): number {
  const blocks = validateBlocks(input.blocks)
  const page = getPage(db, id)
  db.prepare('UPDATE notebook_pages SET title = ?, blocks_json = ?, plain_text = ?, updated_at = ? WHERE id = ?').run(
    cleanTitle(input.title, 'Sem título'),
    JSON.stringify(blocks),
    pagePlainText(blocks),
    now,
    id
  )
  touch(db, page.notebookId)
  return now
}

/** Reordena: coloca a página na posição `index` e renumera as demais. */
export function movePage(db: Database, id: number, index: number): void {
  const page = getPage(db, id)
  transaction(db, () => {
    const ids = (db.prepare('SELECT id FROM notebook_pages WHERE notebook_id = ? AND id != ? ORDER BY position, id').all(page.notebookId, id) as { id: number }[]).map(
      (r) => r.id
    )
    ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id)
    const set = db.prepare('UPDATE notebook_pages SET position = ? WHERE id = ?')
    ids.forEach((pid, i) => set.run(i, pid))
  })
}

/** Exclui a página; o caderno nunca fica sem nenhuma. */
export function deletePage(db: Database, id: number): void {
  const page = getPage(db, id)
  const count = getNotebook(db, page.notebookId).pages.length
  if (count <= 1) throw new Error('O caderno precisa de pelo menos uma página')
  transaction(db, () => {
    db.prepare('DELETE FROM notebook_pages WHERE id = ?').run(id)
    const ids = (db.prepare('SELECT id FROM notebook_pages WHERE notebook_id = ? ORDER BY position, id').all(page.notebookId) as { id: number }[]).map((r) => r.id)
    const set = db.prepare('UPDATE notebook_pages SET position = ? WHERE id = ?')
    ids.forEach((pid, i) => set.run(i, pid))
    touch(db, page.notebookId)
  })
}
