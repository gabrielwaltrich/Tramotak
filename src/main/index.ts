import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { IPC, type AppInfo } from '@shared/ipc'
import { openDatabase, type Database } from './db/database'
import { getDashboard } from './db/dashboard'
import { getSettings, updateSettings } from './db/settings'
import { search } from './db/search'
import { registerCourseIpc } from './ipc/courses'
import { registerLessonIpc } from './ipc/lessons'
import { registerNoteIpc } from './ipc/notes'
import { registerFlashcardIpc } from './ipc/flashcards'
import { registerPlannerIpc } from './ipc/planner'
import { registerQuestionIpc } from './ipc/questions'
import { registerNotebookIpc } from './ipc/notebooks'
import { registerMediaIpc } from './ipc/media'
import { registerAiIpc } from './ipc/ai'
import { registerPdfIpc } from './ipc/pdf'
import { registerBackupIpc } from './ipc/backup'
import { applyPendingRestore, autoBackup } from './backup/backup'
import { getInternal, setInternal } from './db/settings'
import { startNotifier } from './notifier'
import { DurationScanner } from './media/durations'
import { ensureMemoryStates } from './db/flashcards'
import { Updater } from './updater'
import { probe } from './media/ffmpeg'
import { handleMediaProtocol, registerMediaScheme } from './protocol/media'
import { PIP_CHILD_FLAG } from './pip/messages'
import { runPipChild } from './pip/child'
import { PipHost } from './pip/host'
import { processTransport, windowTransport } from './pip/transport'
import { choosePipMode } from './pip/mode'
import type { PipCommand, PipOpenRequest } from '@shared/pip'

registerMediaScheme()

let db: Database | undefined
let mainWindow: BrowserWindow | undefined
let pip: PipHost | undefined

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0b0f',
    title: 'Tramotak',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow = win
  // Fechar o app fecha também a janela flutuante.
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = undefined
    pip?.close()
  })

  win.once('ready-to-show', () => {
    win.show()
    // Gancho de teste: confirma que a janela abriu (usado para validar a reabertura depois de atualizar).
    if (process.env.TRAMOTAK_STARTED_FILE) writeFileSync(process.env.TRAMOTAK_STARTED_FILE, `${app.getVersion()} ${Date.now()}\n`, { flag: 'a' })
  })

  // Links externos abrem no navegador do sistema, nunca dentro do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(db: Database): void {
  ipcMain.handle(
    IPC.appInfo,
    (): AppInfo => ({
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      electron: process.versions.electron,
      dataPath: app.getPath('userData')
    })
  )
  ipcMain.handle(IPC.filesOpenDataFolder, async () => {
    const error = await shell.openPath(app.getPath('userData'))
    if (error) throw new Error(error)
  })
  ipcMain.handle(IPC.dashboardGet, () => getDashboard(db))
  ipcMain.handle(IPC.searchQuery, (_e, text: unknown) => search(db, String(text ?? '').slice(0, 200)))
  ipcMain.handle(IPC.settingsGet, () => getSettings(db))
  ipcMain.handle(IPC.settingsUpdate, (_e, patch) => {
    const settings = updateSettings(db, patch ?? {})
    pip?.settingsChanged(settings)
    return settings
  })
}

/** Janela flutuante do player: janela do app ou processo separado em X11 (ver `choosePipMode`). */
function registerPip(db: Database, convertedDir: string): PipHost {
  const { mode, onTop } = choosePipMode(process.platform, process.env, app.commandLine.getSwitchValue('ozone-platform'))
  const host = new PipHost({
    db,
    convertedDir,
    createTransport: (options, handlers, fallback) =>
      mode === 'process' && !fallback ? processTransport(options, handlers) : windowTransport(options, handlers, onTop && !fallback),
    broadcast: (event) => mainWindow?.webContents.send(IPC.pipEvent, event),
    focusApp: () => {
      if (!mainWindow) return
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
  ipcMain.handle(IPC.pipOpen, (_e, request: PipOpenRequest) => {
    if (!request || !Number.isInteger(request.lessonId)) throw new Error('Aula inválida')
    return host.open({
      lessonId: request.lessonId,
      time: Number.isFinite(request.time) ? request.time : 0,
      playing: request.playing === true,
      playback: request.playback,
      autoplayNext: request.autoplayNext !== false
    })
  })
  ipcMain.handle(IPC.pipClose, () => host.close())
  ipcMain.handle(IPC.pipCommand, (_e, command: PipCommand) => command && typeof command === 'object' && host.command(command))
  ipcMain.handle(IPC.pipStatus, () => host.status())
  return host
}

// O mesmo executável abre só a janela flutuante quando chamado pelo app com PIP_CHILD_FLAG.
const pipChild = process.argv.includes(PIP_CHILD_FLAG)
if (pipChild) runPipChild()

app.whenReady().then(() => {
  if (pipChild) return
  electronApp.setAppUserModelId('com.tramotak.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  const userData = app.getPath('userData')
  const dbPath = join(userData, 'tramotak.db')
  const backupsDir = join(userData, 'backups')
  if (applyPendingRestore(userData, dbPath, backupsDir)) console.log('Backup restaurado')
  db = openDatabase(dbPath)
  // Cartas estudadas antes do FSRS (ou importadas) ganham a memória calculada pelo histórico.
  const migrated = ensureMemoryStates(db)
  if (migrated) console.log(`FSRS: memória calculada para ${migrated} cartas`)
  registerIpc(db)
  // Durações dos vídeos medidas pelo FFmpeg, em segundo plano (importação, revalidação e ao abrir o app).
  const durations = new DurationScanner({
    db,
    readDuration: async (file) => (await probe(file)).durationSec,
    onUpdate: (update) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.coursesDurationsUpdated, update)
    }
  })
  registerCourseIpc(db, (courseId) => void durations.request(courseId))
  ipcMain.handle(IPC.coursesFillDurations, (_e, id: unknown) => {
    if (Number.isInteger(id)) void durations.request(id as number)
  })
  registerLessonIpc(db)
  registerNoteIpc(db)
  registerFlashcardIpc(db)
  registerPlannerIpc(db)
  registerQuestionIpc(db)
  registerNotebookIpc(db)
  const convertedDir = join(app.getPath('userData'), 'converted')
  handleMediaProtocol(db, convertedDir)
  pip = registerPip(db, convertedDir)
  const mediaQueue = registerMediaIpc(db, convertedDir)
  registerAiIpc(db)
  registerPdfIpc(db)
  registerBackupIpc({
    db,
    userData,
    backupsDir,
    appVersion: app.getVersion(),
    // AppImage e .exe portátil rodam de uma cópia temporária que some ao sair, e relançar dali não é confiável:
    // nesses casos o app fecha e a restauração acontece quando a pessoa abrir de novo.
    canRelaunch: !process.env.APPIMAGE && !process.env.PORTABLE_EXECUTABLE_FILE,
    restart: (relaunch) => {
      db?.close()
      db = undefined
      if (relaunch) app.relaunch()
      app.exit(0)
    }
  })
  scheduleAutoBackup(backupsDir)
  createWindow()
  setTimeout(() => void durations.requestAll(), 3000)

  const updater = new Updater({
    enabled: () => (db ? getSettings(db).autoUpdateCheck : false),
    onState: (info) => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.updatesState, info)
    }
  })
  ipcMain.handle(IPC.updatesInfo, () => updater.info())
  ipcMain.handle(IPC.updatesCheck, () => updater.check())
  ipcMain.handle(IPC.updatesInstall, () => updater.install())
  ipcMain.handle(IPC.updatesOpenRelease, () => updater.openRelease())
  updater.start()

  // Ao sair, encerra o trabalho em segundo plano (FFmpeg, whisper) para nenhum processo filho segurar o app.
  app.on('before-quit', () => {
    durations.stop()
    mediaQueue.cancelAll()
    pip?.close()
    // Preferências guardadas pela janela (aparência etc.) vão para o disco já, mesmo que o fechamento demore e o
    // processo acabe encerrado à força (ex.: instalador de atualização).
    session.defaultSession.flushStorageData()
  })
  startNotifier(db, () => mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

/** Backup automático: um minuto depois de abrir e a cada 6 h (só grava se o último tiver mais de ~20 h). */
function scheduleAutoBackup(backupsDir: string): void {
  const run = () => {
    if (!db || !getSettings(db).autoBackup) return
    try {
      const last = getInternal(db, 'lastAutoBackupAt')
      if (autoBackup(db, backupsDir, typeof last === 'number' ? last : null)) setInternal(db, 'lastAutoBackupAt', Math.floor(Date.now() / 1000))
    } catch (error) {
      console.error('Backup automático falhou:', error)
    }
  }
  setTimeout(run, 60_000).unref()
  setInterval(run, 6 * 3600_000).unref()
}

app.on('will-quit', () => {
  db?.close()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
