import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { Database } from '../db/database'
import { createNote, deleteNote, listNotes, updateNote } from '../db/notes'

function assertId(id: unknown): number {
  if (!Number.isInteger(id)) throw new Error('Identificador inválido')
  return id as number
}

export function registerNoteIpc(db: Database): void {
  ipcMain.handle(IPC.notesList, (_e, lessonId: number) => listNotes(db, assertId(lessonId)))
  ipcMain.handle(IPC.notesCreate, (_e, input: { lessonId: number; timestampSec: number | null; body: string }) =>
    createNote(db, { lessonId: assertId(input?.lessonId), timestampSec: input.timestampSec ?? null, body: input.body })
  )
  ipcMain.handle(IPC.notesUpdate, (_e, id: number, body: string) => updateNote(db, assertId(id), body))
  ipcMain.handle(IPC.notesDelete, (_e, id: number) => deleteNote(db, assertId(id)))
}
