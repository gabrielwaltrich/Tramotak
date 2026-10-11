import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { ipcMain, shell } from 'electron'
import type { ProgressUpdate } from '@shared/course'
import { IPC } from '@shared/ipc'
import type { Database } from '../db/database'
import {
  assetFilePath,
  getLessonView,
  lessonFilePath,
  saveProgress,
  setCompleted,
  setDuration,
  setFavorite
} from '../db/lessons'

/** Aulas de texto maiores que isso não são carregadas inline. */
const MAX_TEXT_BYTES = 2 * 1024 * 1024

function assertId(id: unknown): number {
  if (!Number.isInteger(id)) throw new Error('Identificador inválido')
  return id as number
}

const finite = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : null)

async function openPath(path: string) {
  const error = await shell.openPath(path)
  if (error) throw new Error(`Não foi possível abrir o arquivo: ${error}`)
}

export function registerLessonIpc(db: Database): void {
  ipcMain.handle(IPC.lessonsGet, (_e, id: number) => getLessonView(db, assertId(id)))

  ipcMain.handle(IPC.lessonsText, async (_e, id: number) => {
    const path = lessonFilePath(db, assertId(id))
    const info = await stat(path).catch(() => null)
    if (!info) throw new Error('Arquivo não encontrado no disco')
    if (info.size > MAX_TEXT_BYTES) throw new Error('Arquivo de texto grande demais para exibir aqui')
    const ext = extname(path).toLowerCase()
    const format = ext === '.md' || ext === '.markdown' ? 'markdown' : ext === '.html' || ext === '.htm' ? 'html' : 'text'
    return { format, content: await readFile(path, 'utf8') }
  })

  ipcMain.handle(IPC.progressSave, (_e, update: ProgressUpdate) =>
    saveProgress(db, {
      lessonId: assertId(update?.lessonId),
      positionSec: finite(update.positionSec) ?? 0,
      durationSec: finite(update.durationSec),
      watchedSec: Math.min(finite(update.watchedSec) ?? 0, 600)
    })
  )

  ipcMain.handle(IPC.progressSetCompleted, (_e, id: number, value: boolean) => setCompleted(db, assertId(id), Boolean(value)))
  ipcMain.handle(IPC.lessonsSetFavorite, (_e, id: number, value: boolean) => setFavorite(db, assertId(id), Boolean(value)))
  ipcMain.handle(IPC.lessonsSetDuration, (_e, id: number, sec: number) => setDuration(db, assertId(id), finite(sec) ?? 0))

  ipcMain.handle(IPC.filesOpenLesson, (_e, id: number) => openPath(lessonFilePath(db, assertId(id))))
  ipcMain.handle(IPC.filesOpenAsset, (_e, id: number) => openPath(assetFilePath(db, assertId(id))))
  ipcMain.handle(IPC.filesShowLesson, (_e, id: number) => shell.showItemInFolder(lessonFilePath(db, assertId(id))))
}
