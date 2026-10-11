import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { NewCard } from '@shared/flashcards'
import { IPC } from '@shared/ipc'
import type { Rating } from '@shared/srs'
import type { Database } from '../db/database'
import {
  answerCard,
  createCard,
  createDeck,
  deckForCourse,
  deleteCard,
  deleteDeck,
  getDeck,
  listDecks,
  nextStudyCard,
  resetCard,
  updateCard,
  updateDeck
} from '../db/flashcards'
import { importDeckFile } from '../importers/flashcards'

function assertId(id: unknown): number {
  if (!Number.isInteger(id)) throw new Error('Identificador inválido')
  return id as number
}

const optionalId = (id: unknown) => (id === null || id === undefined ? null : assertId(id))

export function registerFlashcardIpc(db: Database): void {
  ipcMain.handle(IPC.decksList, () => listDecks(db))
  ipcMain.handle(IPC.decksGet, (_e, id: number) => getDeck(db, assertId(id)))
  ipcMain.handle(IPC.decksCreate, (_e, input: { title: string; description?: string; courseId?: number | null }) =>
    createDeck(db, { title: input?.title, description: input?.description, courseId: optionalId(input?.courseId) })
  )
  ipcMain.handle(IPC.decksUpdate, (_e, id: number, patch: { title: string; description: string }) =>
    updateDeck(db, assertId(id), { title: patch?.title, description: patch?.description })
  )
  ipcMain.handle(IPC.decksDelete, (_e, id: number) => deleteDeck(db, assertId(id)))
  ipcMain.handle(IPC.decksForCourse, (_e, courseId: number) => deckForCourse(db, assertId(courseId)))

  ipcMain.handle(IPC.decksImport, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Importar baralho',
      properties: ['openFile' as const],
      filters: [
        { name: 'Baralhos (Anki, texto)', extensions: ['apkg', 'txt', 'tsv', 'csv'] },
        { name: 'Todos os arquivos', extensions: ['*'] }
      ]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const path = result.canceled ? null : result.filePaths[0]
    return path ? importDeckFile(db, path) : null
  })

  ipcMain.handle(IPC.cardsCreate, (_e, input: NewCard) =>
    createCard(db, {
      deckId: assertId(input?.deckId),
      front: input.front,
      back: input.back,
      lessonId: optionalId(input.lessonId),
      timestampSec: input.timestampSec ?? null
    })
  )
  ipcMain.handle(IPC.cardsUpdate, (_e, id: number, patch: { front: string; back: string }) =>
    updateCard(db, assertId(id), { front: patch?.front, back: patch?.back })
  )
  ipcMain.handle(IPC.cardsDelete, (_e, id: number) => deleteCard(db, assertId(id)))
  ipcMain.handle(IPC.cardsReset, (_e, id: number) => resetCard(db, assertId(id)))

  ipcMain.handle(IPC.studyNext, (_e, deckId: number) => nextStudyCard(db, assertId(deckId)))
  ipcMain.handle(IPC.studyAnswer, (_e, cardId: number, rating: Rating, durationMs: number) =>
    answerCard(db, assertId(cardId), rating, Number(durationMs) || 0)
  )
}
