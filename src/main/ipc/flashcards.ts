import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { DeckExportRequest, DeckExportResult, NewCard } from '@shared/flashcards'
import { IPC } from '@shared/ipc'
import type { DeckOptions, Rating } from '@shared/srs'
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
import { buildApkg, buildText, exportFileName, loadExport } from '../exporters/anki'
import { stamp } from '../backup/backup'
import { getInternal, setInternal } from '../db/settings'

function assertId(id: unknown): number {
  if (!Number.isInteger(id)) throw new Error('Identificador inválido')
  return id as number
}

const optionalId = (id: unknown) => (id === null || id === undefined ? null : assertId(id))

export function registerFlashcardIpc(db: Database): void {
  ipcMain.handle(IPC.decksList, () => listDecks(db))
  ipcMain.handle(IPC.decksGet, (_e, id: number) => getDeck(db, assertId(id)))
  ipcMain.handle(IPC.decksCreate, (_e, input: { title: string; description?: string; courseId?: number | null; options?: DeckOptions }) =>
    createDeck(db, { title: input?.title, description: input?.description, courseId: optionalId(input?.courseId), options: input?.options })
  )
  ipcMain.handle(IPC.decksUpdate, (_e, id: number, patch: { title: string; description: string; options?: DeckOptions }) =>
    updateDeck(db, assertId(id), { title: patch?.title, description: patch?.description, options: patch?.options })
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

  // Exportar para o Anki: o caminho vem do "Salvar como" aqui no principal, nunca da interface.
  ipcMain.handle(IPC.decksExport, async (event, request: DeckExportRequest): Promise<DeckExportResult | null> => {
    const format = request?.format === 'text' ? 'text' : 'apkg'
    const data = loadExport(db, Array.isArray(request?.deckIds) ? request.deckIds : [])
    if (!data.cards.length) throw new Error('Os baralhos escolhidos não têm cartas')
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Exportar para o Anki',
      defaultPath: exportFileName(data, format, stamp()),
      filters: [format === 'apkg' ? { name: 'Pacote do Anki', extensions: ['apkg'] } : { name: 'Texto (Anki, planilhas)', extensions: ['txt'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    let installId = getInternal(db, 'installId')
    if (typeof installId !== 'string') {
      installId = randomUUID()
      setInternal(db, 'installId', installId)
    }
    const content =
      format === 'apkg' ? await buildApkg(data, { includeSchedule: request.includeSchedule !== false, installId: installId as string }) : buildText(data)
    await writeFile(result.filePath, content)
    return { path: result.filePath, decks: data.decks.length, cards: data.cards.length }
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
