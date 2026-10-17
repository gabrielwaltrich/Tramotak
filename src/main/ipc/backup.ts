import { randomUUID } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { PACKAGE_EXT, type BackupListing, type BackupPlace, type ExportSelection, type ImportRequest } from '@shared/backup'
import { IPC } from '@shared/ipc'
import type { Database } from '../db/database'
import { backupPath, createBackup, inspectBackup, listBackups, stageRestore, stamp } from '../backup/backup'
import { fetchFolderBackup, folderErrorMessage, listFolderBackups, type FolderBackup } from '../backup/folder'
import { buildPackage, exportCatalog, importPackage, parsePackage, previewPackage, serializePackage, type TramotakPackage } from '../backup/package'

const MAX_PACKAGE_FILE = 200 * 1024 * 1024

function windowOf(sender: Electron.WebContents) {
  return BrowserWindow.fromWebContents(sender) ?? undefined
}

async function saveDialog(sender: Electron.WebContents, options: Electron.SaveDialogOptions): Promise<string | null> {
  const win = windowOf(sender)
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

async function openDialog(sender: Electron.WebContents, options: Electron.OpenDialogOptions): Promise<string | null> {
  const win = windowOf(sender)
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
}

export interface BackupIpcOptions {
  db: Database
  userData: string
  backupsDir: string
  appVersion: string
  /** Se o app consegue se reabrir sozinho depois de fechar. */
  canRelaunch: boolean
  /** Fecha o banco e o app, reabrindo se `relaunch` (a restauração acontece no início). */
  restart: (relaunch: boolean) => void
  /** Backup automático na pasta escolhida (Drive, Dropbox, pendrive). */
  folder: FolderBackup
  /** Pasta do app para cópias intermediárias. */
  tmpDir: string
}

export function registerBackupIpc({ db, userData, backupsDir, appVersion, canRelaunch, restart, folder, tmpDir }: BackupIpcOptions): void {
  // O caminho escolhido no seletor fica no processo principal; a interface só confirma.
  let inspectedFile: string | null = null
  // Backup da pasta escolhida já copiado para a pasta do app (nome → cópia), pronto para restaurar.
  let fetched: { name: string; path: string } | null = null
  const packages = new Map<string, TramotakPackage>()

  ipcMain.handle(IPC.backupCreate, async (event) => {
    const path = await saveDialog(event.sender, {
      title: 'Salvar backup do Tramotak',
      defaultPath: `Tramotak-backup-${stamp()}.db`,
      filters: [{ name: 'Backup do Tramotak', extensions: ['db'] }]
    })
    return path ? createBackup(db, path) : null
  })

  ipcMain.handle(IPC.backupList, async (): Promise<BackupListing> => {
    const status = folder.status()
    let backups: BackupListing['folder']['backups'] = []
    let listError: string | null = null
    if (status.path) {
      try {
        backups = await listFolderBackups(status.path)
      } catch (error) {
        listError = folderErrorMessage(error)
      }
    }
    return { dir: backupsDir, backups: listBackups(backupsDir), folder: { ...status, backups, listError } }
  })

  // A pasta só é escolhida pelo seletor do sistema: a interface nunca manda um caminho.
  ipcMain.handle(IPC.backupChooseFolder, async (event) => {
    const path = await openDialog(event.sender, { title: 'Pasta para os backups automáticos', properties: ['openDirectory', 'createDirectory'] })
    if (!path) return null
    await folder.setFolder(path)
    return folder.run()
  })
  ipcMain.handle(IPC.backupClearFolder, () => folder.setFolder(null))
  ipcMain.handle(IPC.backupFolderNow, () => folder.run())
  ipcMain.handle(IPC.backupOpenFolder, async () => {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(backupsDir, { recursive: true })
    const error = await shell.openPath(backupsDir)
    if (error) throw new Error(error)
  })

  ipcMain.handle(IPC.backupInspectFile, async (event) => {
    const path = await openDialog(event.sender, {
      title: 'Escolha o backup para restaurar',
      properties: ['openFile'],
      filters: [{ name: 'Backup do Tramotak', extensions: ['db'] }]
    })
    if (!path) return null
    const info = inspectBackup(path)
    inspectedFile = path
    return info
  })
  ipcMain.handle(IPC.backupInspect, async (_e, name: string, place: BackupPlace = 'app') => {
    if (place !== 'folder') return inspectBackup(backupPath(backupsDir, name))
    const dir = folder.status().path
    if (!dir) throw new Error('Nenhuma pasta de backup escolhida')
    let path: string
    try {
      path = await fetchFolderBackup(dir, name, tmpDir)
    } catch (error) {
      throw new Error(folderErrorMessage(error), { cause: error })
    }
    fetched = { name, path }
    return { ...inspectBackup(path), name }
  })

  /** `name` de um backup da pasta do app ou da pasta escolhida (`place`), ou `null` para o arquivo do seletor. */
  ipcMain.handle(IPC.backupRestore, (_e, name: string | null, place: BackupPlace = 'app') => {
    const fromFolder = place === 'folder' && fetched !== null && fetched.name === name ? fetched.path : null
    if (place === 'folder' && !fromFolder) throw new Error('Escolha o backup de novo')
    const source = name === null ? inspectedFile : (fromFolder ?? backupPath(backupsDir, name))
    if (!source) throw new Error('Escolha um backup primeiro')
    stageRestore(userData, source)
    // Sem reabrir sozinho, dá tempo de a interface avisar para abrir o app de novo.
    setTimeout(() => restart(canRelaunch), canRelaunch ? 300 : 4000)
    return { relaunch: canRelaunch }
  })

  ipcMain.handle(IPC.packageCatalog, () => exportCatalog(db))

  ipcMain.handle(IPC.packageExport, async (event, selection: ExportSelection) => {
    const pkg = buildPackage(db, selection, appVersion)
    const total = pkg.decks.length + pkg.banks.length + pkg.notebooks.length + pkg.mindmaps.length + pkg.courses.filter((c) => c.withData).length
    if (total === 0) throw new Error('Escolha pelo menos um item para exportar')
    const path = await saveDialog(event.sender, {
      title: 'Exportar pacote de estudo',
      defaultPath: `Tramotak-pacote-${stamp()}.${PACKAGE_EXT}`,
      filters: [{ name: 'Pacote do Tramotak', extensions: [PACKAGE_EXT] }]
    })
    if (!path) return null
    const data = serializePackage(pkg)
    await writeFile(path, data)
    return { path, bytes: data.length }
  })

  ipcMain.handle(IPC.packageOpen, async (event) => {
    const path = await openDialog(event.sender, {
      title: 'Importar pacote de estudo',
      properties: ['openFile'],
      filters: [{ name: 'Pacote do Tramotak', extensions: [PACKAGE_EXT, 'json'] }]
    })
    if (!path) return null
    if ((await stat(path)).size > MAX_PACKAGE_FILE) throw new Error('Pacote grande demais')
    const pkg = parsePackage(await readFile(path))
    const token = randomUUID()
    packages.clear()
    packages.set(token, pkg)
    return previewPackage(db, pkg, token)
  })

  ipcMain.handle(IPC.packageImport, (_e, request: ImportRequest) => {
    const pkg = packages.get(String(request?.token))
    if (!pkg) throw new Error('Abra o pacote de novo')
    const map: Record<string, number | null> = {}
    for (const [key, id] of Object.entries(request.courseMap ?? {})) map[key] = Number.isInteger(id) ? (id as number) : null
    const result = importPackage(db, pkg, map)
    packages.delete(String(request.token))
    return result
  })
}
