import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { compareVersions, RELEASES_URL, type UpdateInfo, type UpdateMode, type UpdateState } from '@shared/updates'

const CHECK_EVERY_MS = 6 * 3600_000
const LATEST_API = 'https://api.github.com/repos/gabrielwaltrich/Tramotak/releases/latest'

/** Tipo de pacote no Linux, gravado pelo electron-builder em resources/package-type ("deb", "rpm"…). */
function linuxPackageType(): string | null {
  try {
    return readFileSync(join(process.resourcesPath, 'package-type'), 'utf8').trim()
  } catch {
    return null
  }
}

/** Esta instalação consegue se atualizar sozinha? */
export function updateMode(): UpdateMode {
  if (!app.isPackaged && !process.env.TRAMOTAK_UPDATE_URL) return 'dev'
  if (process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_FILE) return 'auto'
  if (process.platform === 'linux' && process.env.APPIMAGE) return 'auto'
  // .deb: instala com o pkexec (janela do sistema pedindo a senha).
  if (process.platform === 'linux' && linuxPackageType() === 'deb' && existsSync('/usr/bin/pkexec')) return 'auto'
  // macOS exige app assinado para instalar sozinho; o .exe portátil não tem como se trocar.
  return 'notify'
}

/** O .deb pede a senha do sistema para instalar (a interface avisa antes). */
export function needsPassword(): boolean {
  return process.platform === 'linux' && !process.env.APPIMAGE && linuxPackageType() === 'deb'
}

export interface UpdaterOptions {
  enabled: () => boolean
  onState: (info: UpdateInfo) => void
  fetchImpl?: typeof fetch
}

/**
 * Atualizações pelas Releases do GitHub. No modo `auto` o electron-updater baixa em segundo plano e instala ao
 * reiniciar; no modo `notify` o app só consulta a última versão e oferece abrir a página dela.
 */
export class Updater {
  private state: UpdateState = { status: 'idle' }
  private readonly mode = updateMode()
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly options: UpdaterOptions) {
    if (this.mode !== 'auto') return
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = null
    // Para testar com um servidor local (ver docs): TRAMOTAK_UPDATE_URL=http://localhost:8090/
    if (process.env.TRAMOTAK_UPDATE_URL) {
      autoUpdater.forceDevUpdateConfig = !app.isPackaged
      autoUpdater.setFeedURL({ provider: 'generic', url: process.env.TRAMOTAK_UPDATE_URL })
    }
    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }))
    autoUpdater.on('update-not-available', () => this.set({ status: 'none', checkedAt: Date.now() }))
    autoUpdater.on('update-available', (info) => this.set({ status: 'downloading', version: info.version, percent: 0 }))
    autoUpdater.on('download-progress', (p) => {
      const version = 'version' in this.state ? this.state.version : ''
      this.set({ status: 'downloading', version, percent: Math.round(p.percent) })
    })
    autoUpdater.on('update-downloaded', (info) => this.set({ status: 'ready', version: info.version }))
    autoUpdater.on('error', (error) => this.set({ status: 'error', message: friendly(error) }))
  }

  info(): UpdateInfo {
    return { mode: this.mode, current: app.getVersion(), state: this.state, needsPassword: needsPassword() }
  }

  private set(state: UpdateState) {
    this.state = state
    this.options.onState(this.info())
  }

  /** Procura ao abrir (com um atraso, para não pesar no início) e a cada 6 h, se a pessoa deixou ligado. */
  start(delayMs = 15_000): void {
    if (this.mode === 'dev') return
    const tick = () => {
      if (this.options.enabled()) void this.check()
    }
    setTimeout(tick, delayMs).unref()
    this.timer = setInterval(tick, CHECK_EVERY_MS)
    this.timer.unref()
  }

  async check(): Promise<UpdateInfo> {
    if (this.mode === 'dev') return this.info()
    if (this.state.status === 'checking' || this.state.status === 'downloading' || this.state.status === 'ready') return this.info()
    if (this.mode === 'auto') {
      try {
        await autoUpdater.checkForUpdates()
      } catch (error) {
        this.set({ status: 'error', message: friendly(error) })
      }
      return this.info()
    }
    this.set({ status: 'checking' })
    try {
      const response = await (this.options.fetchImpl ?? fetch)(LATEST_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Tramotak' },
        signal: AbortSignal.timeout(20_000)
      })
      if (!response.ok) throw new Error(`GitHub respondeu ${response.status}`)
      const data = (await response.json()) as { tag_name?: string; html_url?: string }
      const latest = String(data.tag_name ?? '')
      if (latest && compareVersions(latest, app.getVersion()) > 0) {
        this.set({ status: 'available', version: latest.replace(/^v/, ''), url: data.html_url ?? RELEASES_URL })
      } else {
        this.set({ status: 'none', checkedAt: Date.now() })
      }
    } catch (error) {
      this.set({ status: 'error', message: friendly(error) })
    }
    return this.info()
  }

  /** Reinicia instalando a versão baixada (modo `auto`). */
  install(): void {
    // Reabre o app depois de instalar (no Windows o instalador faz isso; no Linux o electron-updater).
    if (this.state.status === 'ready') autoUpdater.quitAndInstall(false, true)
  }

  /** Abre a página da versão nova (modo `notify`). */
  openRelease(): Promise<void> {
    return shell.openExternal(this.state.status === 'available' ? this.state.url : RELEASES_URL)
  }
}

function friendly(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|network|fetch failed|timeout/i.test(message)) return 'Sem conexão para procurar atualizações'
  return `Não foi possível procurar atualizações (${message.slice(0, 120)})`
}
