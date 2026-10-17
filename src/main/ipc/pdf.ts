import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { NewHighlight } from '@shared/pdf'
import type { Database } from '../db/database'
import { assertPdf, createHighlight, deleteHighlight, listHighlights, setHighlightColor } from '../db/pdf'

function assertId(id: unknown): number {
  if (!Number.isInteger(id)) throw new Error('Identificador inválido')
  return id as number
}

/** Grifos dos PDFs (da aula ou de um anexo dela). */
export function registerPdfIpc(db: Database): void {
  ipcMain.handle(IPC.pdfHighlights, (_e, lessonId: unknown, assetPath: unknown) => {
    const id = assertId(lessonId)
    return listHighlights(db, id, assertPdf(db, id, assetPath ?? null))
  })
  ipcMain.handle(IPC.pdfHighlightCreate, (_e, input: NewHighlight) => createHighlight(db, { ...input, lessonId: assertId(input?.lessonId) }))
  ipcMain.handle(IPC.pdfHighlightColor, (_e, id: unknown, color: unknown) => setHighlightColor(db, assertId(id), color))
  ipcMain.handle(IPC.pdfHighlightDelete, (_e, id: unknown) => deleteHighlight(db, assertId(id)))
}
