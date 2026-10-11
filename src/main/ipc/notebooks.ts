import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC, type SaveFileRequest } from '@shared/ipc'
import type { MindMapData } from '@shared/mindmap'
import type { Database } from '../db/database'
import { createMindMap, deleteMindMap, getMindMap, listMindMaps, saveMindMap } from '../db/mindmaps'
import { createNotebook, createPage, deleteNotebook, deletePage, getNotebook, getPage, listNotebooks, movePage, notebookPages, renameNotebook, savePage } from '../db/notebooks'

const MAX_EXPORT_BYTES = 50 * 1024 * 1024

function assertId(id: unknown): number {
  if (!Number.isInteger(id)) throw new Error('Identificador inválido')
  return id as number
}

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || 'arquivo'
const windowOf = (sender: Electron.WebContents) => BrowserWindow.fromWebContents(sender) ?? undefined

async function saveDialog(sender: Electron.WebContents, options: Electron.SaveDialogOptions): Promise<string | null> {
  const win = windowOf(sender)
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

/**
 * Imprime o HTML num arquivo PDF usando uma janela oculta, sem JavaScript nem acesso ao app:
 * o conteúdo é só para desenhar.
 */
async function htmlToPdf(html: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'tramotak-pdf-'))
  const file = join(dir, 'caderno.html')
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false } })
  try {
    await writeFile(file, html, 'utf8')
    await win.loadFile(file)
    return await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 } })
  } finally {
    win.destroy()
    await rm(dir, { recursive: true, force: true })
  }
}

export function registerNotebookIpc(db: Database): void {
  ipcMain.handle(IPC.notebooksList, () => listNotebooks(db))
  ipcMain.handle(IPC.notebooksGet, (_e, id: number) => getNotebook(db, assertId(id)))
  ipcMain.handle(IPC.notebooksCreate, (_e, title: string) => createNotebook(db, String(title ?? '')))
  ipcMain.handle(IPC.notebooksRename, (_e, id: number, title: string) => renameNotebook(db, assertId(id), String(title ?? '')))
  ipcMain.handle(IPC.notebooksDelete, (_e, id: number) => deleteNotebook(db, assertId(id)))
  ipcMain.handle(IPC.notebooksPages, (_e, id: number) => notebookPages(db, assertId(id)))

  ipcMain.handle(IPC.notebooksExportPdf, async (event, id: number, html: string) => {
    const notebook = getNotebook(db, assertId(id))
    if (typeof html !== 'string' || html.length > MAX_EXPORT_BYTES) throw new Error('Conteúdo inválido para exportar')
    const path = await saveDialog(event.sender, {
      title: 'Exportar caderno em PDF',
      defaultPath: `${safeName(notebook.title)}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (!path) return null
    await writeFile(path, await htmlToPdf(html))
    return path
  })

  ipcMain.handle(IPC.pagesGet, (_e, id: number) => getPage(db, assertId(id)))
  ipcMain.handle(IPC.pagesCreate, (_e, notebookId: number) => createPage(db, assertId(notebookId)))
  ipcMain.handle(IPC.pagesSave, (_e, id: number, input: { title: string; blocks: unknown }) =>
    savePage(db, assertId(id), { title: String(input?.title ?? ''), blocks: input?.blocks })
  )
  ipcMain.handle(IPC.pagesMove, (_e, id: number, index: number) => movePage(db, assertId(id), Number(index) || 0))
  ipcMain.handle(IPC.pagesDelete, (_e, id: number) => deletePage(db, assertId(id)))

  ipcMain.handle(IPC.mindmapsList, () => listMindMaps(db))
  ipcMain.handle(IPC.mindmapsGet, (_e, id: number) => getMindMap(db, assertId(id)))
  ipcMain.handle(IPC.mindmapsCreate, (_e, title: string) => createMindMap(db, String(title ?? '')))
  ipcMain.handle(IPC.mindmapsSave, (_e, id: number, input: { title: string; data: MindMapData }) =>
    saveMindMap(db, assertId(id), { title: String(input?.title ?? ''), data: input?.data })
  )
  ipcMain.handle(IPC.mindmapsDelete, (_e, id: number) => deleteMindMap(db, assertId(id)))

  ipcMain.handle(IPC.mindmapsImport, async (event) => {
    const win = windowOf(event.sender)
    const options: Electron.OpenDialogOptions = { title: 'Importar mapa mental', properties: ['openFile'], filters: [{ name: 'Mapa mental (JSON)', extensions: ['json'] }] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const path = result.canceled ? null : result.filePaths[0]
    if (!path) return null
    let parsed: { title?: string; data?: unknown }
    try {
      parsed = JSON.parse(await readFile(path, 'utf8'))
    } catch {
      throw new Error('Arquivo JSON inválido')
    }
    // Aceita o arquivo exportado ({ title, data }) ou só os dados do mapa.
    const data = parsed.data ?? parsed
    const title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title : basename(path, extname(path))
    return createMindMap(db, title, data)
  })

  ipcMain.handle(IPC.filesSave, async (event, request: SaveFileRequest) => {
    if (typeof request?.content !== 'string' || request.content.length > MAX_EXPORT_BYTES * 1.4) throw new Error('Conteúdo inválido')
    const path = await saveDialog(event.sender, {
      title: String(request.title ?? 'Salvar'),
      defaultPath: safeName(String(request.defaultName ?? 'arquivo')),
      filters: Array.isArray(request.filters) ? request.filters : undefined
    })
    if (!path) return null
    await writeFile(path, request.encoding === 'base64' ? Buffer.from(request.content, 'base64') : request.content, request.encoding === 'base64' ? undefined : 'utf8')
    return path
  })
}
