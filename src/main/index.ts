import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { IPC, type AppInfo } from '@shared/ipc'
import { openDatabase, type Database } from './db/database'
import { registerCourseIpc } from './ipc/courses'
import { registerLessonIpc } from './ipc/lessons'
import { handleMediaProtocol, registerMediaScheme } from './protocol/media'

registerMediaScheme()

let db: Database | undefined

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

  win.once('ready-to-show', () => win.show())

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

function registerIpc(): void {
  ipcMain.handle(
    IPC.appInfo,
    (): AppInfo => ({
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      electron: process.versions.electron
    })
  )
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.tramotak.app')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  db = openDatabase(join(app.getPath('userData'), 'tramotak.db'))
  registerIpc()
  registerCourseIpc(db)
  registerLessonIpc(db)
  handleMediaProtocol(db)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  db?.close()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
