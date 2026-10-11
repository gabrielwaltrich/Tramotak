import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, ipcMain, shell } from 'electron'
import type { Compatibility, MediaJobKind } from '@shared/media'
import { IPC } from '@shared/ipc'
import type { Database } from '../db/database'
import { lessonFilePath } from '../db/lessons'
import { courseVideoLessons, deleteTranscript, getConversion, getTranscript, setConversion } from '../db/media'
import { ffmpegPath, probe } from '../media/ffmpeg'
import { conversionStorage, MediaQueue } from '../media/jobs'
import { getSecret, hasSecret, setSecret } from '../secrets'

function assertId(id: unknown): number {
  if (!Number.isInteger(id)) throw new Error('Identificador inválido')
  return id as number
}

export function registerMediaIpc(db: Database, convertedDir: string): MediaQueue {
  const queue = new MediaQueue({
    db,
    convertedDir,
    getApiKey: () => getSecret(db, 'groqKey'),
    onChange: (jobs) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.mediaJobsChanged, jobs)
    }
  })

  ipcMain.handle(IPC.mediaJobs, () => queue.list())
  ipcMain.handle(IPC.mediaEnqueue, (_e, kind: MediaJobKind, lessonId: number) => {
    if (kind !== 'convert' && kind !== 'transcribe') throw new Error('Tarefa inválida')
    return queue.enqueue(kind, assertId(lessonId))
  })
  ipcMain.handle(IPC.mediaCancel, (_e, id: number) => queue.cancel(assertId(id)))
  ipcMain.handle(IPC.mediaClearFinished, () => queue.clearFinished())

  /** Compatibilidade do arquivo original da aula (o que precisaria para tocar). */
  ipcMain.handle(IPC.mediaProbe, async (_e, lessonId: number): Promise<Compatibility & { converted: boolean }> => {
    const id = assertId(lessonId)
    const info = await probe(lessonFilePath(db, id))
    return { ...info.compatibility, converted: getConversion(db, id) !== null }
  })

  /** Verifica todos os vídeos de um curso e devolve os que não tocam (e ainda não foram convertidos). */
  ipcMain.handle(IPC.mediaCheckCourse, async (_e, courseId: number) => {
    const out: { lessonId: number; title: string; reason: string; plan: string }[] = []
    let checked = 0
    for (const lesson of courseVideoLessons(db, assertId(courseId))) {
      checked++
      if (lesson.convertedFile) continue
      try {
        const info = await probe(lessonFilePath(db, lesson.id))
        if (!info.compatibility.playable) out.push({ lessonId: lesson.id, title: lesson.title, reason: info.compatibility.reason, plan: info.compatibility.plan })
      } catch (error) {
        out.push({ lessonId: lesson.id, title: lesson.title, reason: error instanceof Error ? error.message : 'Ilegível', plan: 'none' })
      }
    }
    return { checked, incompatible: out }
  })

  /** Volta a tocar o arquivo original e apaga a cópia convertida. */
  ipcMain.handle(IPC.mediaRemoveConversion, async (_e, lessonId: number) => {
    const id = assertId(lessonId)
    const conversion = getConversion(db, id)
    setConversion(db, id, null)
    if (conversion) await rm(join(convertedDir, conversion.file), { force: true })
  })

  ipcMain.handle(IPC.mediaStorage, (_e, clean: boolean) => conversionStorage(db, convertedDir, Boolean(clean)))
  ipcMain.handle(IPC.transcriptGet, (_e, lessonId: number) => getTranscript(db, assertId(lessonId)))
  ipcMain.handle(IPC.transcriptDelete, (_e, lessonId: number) => deleteTranscript(db, assertId(lessonId)))

  ipcMain.handle(IPC.secretsSetGroqKey, (_e, key: string | null) => setSecret(db, 'groqKey', typeof key === 'string' ? key : null))
  ipcMain.handle(IPC.secretsHasGroqKey, () => hasSecret(db, 'groqKey'))
  ipcMain.handle(IPC.openFfmpegLicense, async () => {
    const error = await shell.openPath(`${ffmpegPath()}.LICENSE`)
    if (error) throw new Error(error)
  })

  return queue
}
