import { writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { SendNotesRequest } from '@shared/notes'
import type { Database } from '../db/database'
import { createNote, deleteNote, listAllNotes, listNotes, sendNotesToNotebook, updateNote } from '../db/notes'

function assertId(id: unknown): number {
  if (!Number.isInteger(id)) throw new Error('Identificador inválido')
  return id as number
}

const optionalId = (id: unknown) => (id === null || id === undefined ? null : assertId(id))

/** Nome de arquivo seguro em qualquer sistema. */
function fileName(name: unknown): string {
  const printable = [...String(name ?? '')].filter((c) => c.charCodeAt(0) >= 32).join('')
  const base = printable.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
  return `${base || 'Anotações'}.md`
}

export function registerNoteIpc(db: Database): void {
  ipcMain.handle(IPC.notesList, (_e, lessonId: number) => listNotes(db, assertId(lessonId)))
  ipcMain.handle(IPC.notesCreate, (_e, input: { lessonId: number; timestampSec: number | null; body: string; page?: number | null; assetPath?: string | null }) =>
    createNote(db, {
      lessonId: assertId(input?.lessonId),
      timestampSec: input.timestampSec ?? null,
      body: input.body,
      page: input.page ?? null,
      assetPath: input.assetPath ?? null
    })
  )
  ipcMain.handle(IPC.notesUpdate, (_e, id: number, body: string) => updateNote(db, assertId(id), body))
  ipcMain.handle(IPC.notesDelete, (_e, id: number) => deleteNote(db, assertId(id)))
  ipcMain.handle(IPC.notesAll, (_e, courseId: unknown) => listAllNotes(db, optionalId(courseId)))
  ipcMain.handle(IPC.notesToNotebook, (_e, request: SendNotesRequest) =>
    sendNotesToNotebook(db, {
      noteIds: Array.isArray(request?.noteIds) ? request.noteIds : [],
      notebookId: optionalId(request?.notebookId),
      notebookTitle: typeof request?.notebookTitle === 'string' ? request.notebookTitle.slice(0, 200) : undefined,
      pageId: optionalId(request?.pageId),
      pageTitle: typeof request?.pageTitle === 'string' ? request.pageTitle.slice(0, 200) : undefined
    })
  )
  ipcMain.handle(IPC.notesExport, async (event, markdown: unknown, suggestedName: unknown) => {
    const text = String(markdown ?? '')
    if (text.length > 20_000_000) throw new Error('Conteúdo grande demais')
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { title: 'Exportar anotações', defaultPath: fileName(suggestedName), filters: [{ name: 'Markdown', extensions: ['md'] }] }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, text, 'utf8')
    return result.filePath
  })
}
