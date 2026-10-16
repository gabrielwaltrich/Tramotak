import { join } from 'node:path'
import { BrowserWindow, ipcMain, screen } from 'electron'
import { is } from '@electron-toolkit/utils'
import {
  clampOpacity,
  initialPipBounds,
  PIP_ASPECT,
  PIP_CHANNELS,
  PIP_MAX_WIDTH,
  PIP_MIN_WIDTH,
  restorePipBounds,
  type PipCommand,
  type PipSettings,
  type Rect
} from '@shared/pip'

export interface PipWindowOptions {
  settings: PipSettings
  /** Última posição/tamanho guardados (usados se a preferência pedir). */
  savedBounds: unknown
  /** Mensagem crua da janela; quem recebe confere com `parsePipEvent`. */
  onEvent(raw: unknown): void
  onBounds(rect: Rect): void
  onClosed(): void
}

export interface PipWindowHandle {
  send(command: PipCommand): void
  close(): void
  readonly window: BrowserWindow
}

interface Current {
  win: BrowserWindow
  options: PipWindowOptions
  ready: boolean
  queue: PipCommand[]
}

let current: Current | null = null
let registered = false

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** Os canais valem para o processo todo; só a janela flutuante atual é atendida. */
function registerHandlers(): void {
  if (registered) return
  registered = true
  const owner = (event: Electron.IpcMainEvent) =>
    current && !current.win.isDestroyed() && event.sender === current.win.webContents ? current : null

  ipcMain.on(PIP_CHANNELS.event, (event, raw: unknown) => {
    const c = owner(event)
    if (!c) return
    // Comandos enviados antes de a página carregar ficam guardados até ela avisar que está pronta.
    if ((raw as { type?: unknown } | null)?.type === 'ready') {
      c.ready = true
      for (const command of c.queue.splice(0)) c.win.webContents.send(PIP_CHANNELS.command, command)
    }
    c.options.onEvent(raw)
  })
  ipcMain.on(PIP_CHANNELS.opacity, (event, value: unknown) => owner(event)?.win.setOpacity(clampOpacity(value)))
  ipcMain.on(PIP_CHANNELS.move, (event, x: unknown, y: unknown) => {
    const c = owner(event)
    if (c && finite(x) && finite(y)) c.win.setPosition(Math.round(x), Math.round(y))
  })
  ipcMain.handle(PIP_CHANNELS.getBounds, (event) => {
    const c = current && !current.win.isDestroyed() && event.sender === current.win.webContents ? current : null
    if (!c) throw new Error('Janela flutuante fechada')
    return c.win.getBounds()
  })
  ipcMain.on(PIP_CHANNELS.bounds, (event, rect: unknown) => {
    const c = owner(event)
    const r = rect as Partial<Rect> | null
    if (!c || !r || ![r.x, r.y, r.width, r.height].every(finite)) return
    const width = Math.round(Math.min(PIP_MAX_WIDTH, Math.max(PIP_MIN_WIDTH, r.width!)))
    c.win.setBounds({ x: Math.round(r.x!), y: Math.round(r.y!), width, height: Math.round(width / PIP_ASPECT) })
  })
}

function pickBounds(settings: PipSettings, saved: unknown): Rect {
  const restored = settings.rememberBounds ? restorePipBounds(saved, screen.getAllDisplays().map((d) => d.workArea)) : null
  if (restored) return restored
  // Nova: no monitor onde está o mouse (normalmente o mesmo do app).
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  return initialPipBounds(display.workArea, settings.size, settings.corner)
}

/** Cria a janela flutuante: sem moldura, sempre por cima, 16:9, sem ícone na barra de tarefas. */
export function createPipWindow(options: PipWindowOptions): PipWindowHandle {
  registerHandlers()
  current?.win.destroy()

  const bounds = pickBounds(options.settings, options.savedBounds)
  const win = new BrowserWindow({
    ...bounds,
    minWidth: PIP_MIN_WIDTH,
    minHeight: Math.round(PIP_MIN_WIDTH / PIP_ASPECT),
    frame: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    backgroundColor: '#000000',
    title: 'Tramotak — janela flutuante',
    webPreferences: {
      preload: join(__dirname, '../preload/pip.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  const c: Current = { win, options, ready: false, queue: [] }
  current = c

  // "floating" fica acima das janelas comuns sem cobrir menus e avisos do sistema.
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true)
  // No X11 o Electron aplica a proporção à janela com a sombra invisível em volta e o vídeo sai achatado; lá os
  // cantos de redimensionar da própria página já mantêm 16:9.
  if (process.platform !== 'linux') win.setAspectRatio(PIP_ASPECT)
  win.setOpacity(options.settings.opacity)
  // Aparece sem roubar o foco de onde a pessoa está digitando.
  win.once('ready-to-show', () => win.showInactive())

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  let boundsTimer: ReturnType<typeof setTimeout> | undefined
  const reportBounds = () => {
    clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => !win.isDestroyed() && options.onBounds(win.getBounds()), 400)
  }
  win.on('move', reportBounds)
  win.on('resize', reportBounds)
  win.on('close', () => {
    clearTimeout(boundsTimer)
    options.onBounds(win.getBounds())
  })
  win.on('closed', () => {
    if (current === c) current = null
    options.onClosed()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/pip.html`)
  else win.loadFile(join(__dirname, '../renderer/pip.html'))

  return {
    window: win,
    send(command) {
      if (win.isDestroyed()) return
      if (c.ready) win.webContents.send(PIP_CHANNELS.command, command)
      else c.queue.push(command)
    },
    close() {
      if (!win.isDestroyed()) win.close()
    }
  }
}
