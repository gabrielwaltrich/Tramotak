import { mkdirSync, rmSync } from 'node:fs'
import { access, constants, copyFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { EMPTY_FOLDER_STATUS, FOLDER_AUTO_PREFIX, FOLDER_KEEP, type BackupEntry, type FolderBackupStatus } from '@shared/backup'
import type { Database } from '../db/database'
import { getInternal, setInternal } from '../db/settings'
import { AUTO_INTERVAL_SEC, createBackup, stamp } from './backup'

/**
 * Backup automático numa pasta escolhida pela pessoa (Google Drive, Dropbox, OneDrive, pendrive): uma sincronização
 * simples. A pasta pode sumir (pendrive fora, Drive desmontado) ou travar (pasta de rede), então tudo aqui tem prazo e
 * nunca cria a pasta: gravar num caminho recriado no disco local daria a falsa impressão de que o backup foi para a nuvem.
 */

const STATUS_KEY = 'folderBackup'
const AUTO_NAME = /^Tramotak-auto-\d{4}-\d{2}-\d{2}-\d{4}\.db$/
const LISTED_NAME = /^Tramotak-.+\.db$/
const DEFAULT_TIMEOUT_MS = 60_000

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)))
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** Erros do sistema de arquivos em português, sem o caminho cru repetido. */
export function folderErrorMessage(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'A pasta não foi encontrada (pendrive ou Drive desconectado?)'
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'Sem permissão para gravar na pasta'
  if (code === 'ENOSPC' || code === 'EDQUOT') return 'Sem espaço livre na pasta'
  return error instanceof Error ? error.message : String(error)
}

/** Confere que a pasta existe, é pasta e aceita gravação. */
export async function checkFolder(folder: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
  const info = await withTimeout(stat(folder), timeoutMs, 'A pasta demorou demais para responder')
  if (!info.isDirectory()) throw Object.assign(new Error('O caminho escolhido não é uma pasta'), { code: 'ENOTDIR' })
  await withTimeout(access(folder, constants.W_OK), timeoutMs, 'A pasta demorou demais para responder')
}

/** Backups do Tramotak na pasta (automáticos e os salvos à mão com o nome padrão), do mais novo ao mais antigo. */
export async function listFolderBackups(folder: string, timeoutMs = 5000): Promise<BackupEntry[]> {
  const names = (await withTimeout(readdir(folder), timeoutMs, 'A pasta demorou demais para responder')).filter((n) => LISTED_NAME.test(n))
  const entries = await withTimeout(
    Promise.all(
      names.map(async (name): Promise<BackupEntry> => {
        const info = await stat(join(folder, name))
        return { name, bytes: info.size, modifiedAt: Math.floor(info.mtimeMs / 1000), kind: name.startsWith(FOLDER_AUTO_PREFIX) ? 'auto' : 'manual' }
      })
    ),
    timeoutMs,
    'A pasta demorou demais para responder'
  )
  return entries.sort((a, b) => b.modifiedAt - a.modifiedAt || b.name.localeCompare(a.name))
}

/** Mantém só os `keep` automáticos mais novos (pelo nome, que carrega a data) e tira restos de cópias interrompidas. */
export async function pruneFolder(folder: string, keep = FOLDER_KEEP): Promise<void> {
  const names = await readdir(folder)
  const autos = names.filter((n) => AUTO_NAME.test(n)).sort().reverse()
  const leftovers = names.filter((n) => n.startsWith(FOLDER_AUTO_PREFIX) && n.endsWith('.db.partial'))
  for (const name of [...autos.slice(keep), ...leftovers]) await rm(join(folder, name), { force: true })
}

/**
 * Grava um backup na pasta: o banco é copiado primeiro para a pasta do app (rápido e consistente) e só depois vai para
 * a pasta escolhida com nome provisório, renomeado no fim. Assim o Drive/Dropbox nunca sincroniza um arquivo pela metade.
 */
export async function writeFolderBackup(
  db: Database,
  folder: string,
  tmpDir: string,
  now = new Date(),
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<{ file: string; bytes: number }> {
  await checkFolder(folder, timeoutMs)
  mkdirSync(tmpDir, { recursive: true })
  const file = `${FOLDER_AUTO_PREFIX}${stamp(now)}.db`
  const local = join(tmpDir, file)
  const partial = join(folder, `${file}.partial`)
  try {
    const { bytes } = createBackup(db, local)
    await withTimeout(copyFile(local, partial), timeoutMs, 'A pasta demorou demais para receber o backup')
    await withTimeout(rename(partial, join(folder, file)), timeoutMs, 'A pasta demorou demais para receber o backup')
    await pruneFolder(folder).catch((error) => console.error('Limpeza da pasta de backup falhou:', error))
    return { file, bytes }
  } finally {
    rmSync(local, { force: true })
  }
}

/** Copia um backup da pasta para a pasta do app (para inspecionar e restaurar sem ler direto do Drive). */
export async function fetchFolderBackup(folder: string, name: string, tmpDir: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  if (typeof name !== 'string' || name !== basename(name) || !LISTED_NAME.test(name)) throw new Error('Backup inválido')
  mkdirSync(tmpDir, { recursive: true })
  const dest = join(tmpDir, 'da-pasta.db')
  await withTimeout(copyFile(join(folder, name), dest), timeoutMs, 'A pasta demorou demais para responder')
  return dest
}

const totalChanges = (db: Database) => (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n

export function readFolderStatus(db: Database): FolderBackupStatus {
  const raw = getInternal(db, STATUS_KEY) as Partial<FolderBackupStatus> | undefined
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  return raw && typeof raw === 'object'
    ? { path: str(raw.path), lastAt: num(raw.lastAt), lastFile: str(raw.lastFile), error: str(raw.error), errorAt: num(raw.errorAt), failingSince: num(raw.failingSince) }
    : { ...EMPTY_FOLDER_STATUS }
}

export interface FolderBackupOptions {
  db: Database
  /** Pasta do app para a cópia intermediária. */
  tmpDir: string
  timeoutMs?: number
  now?: () => Date
}

/** Estado e execução do backup na pasta (um de cada vez). */
export class FolderBackup {
  private running: Promise<FolderBackupStatus> | null = null
  /** Mudanças no banco já cobertas pelo último backup na pasta (para o backup ao fechar só rodar se algo mudou). */
  private baseline: number

  constructor(private readonly options: FolderBackupOptions) {
    this.baseline = totalChanges(options.db)
  }

  private get now(): Date {
    return this.options.now?.() ?? new Date()
  }

  status(): FolderBackupStatus {
    return readFolderStatus(this.options.db)
  }

  private save(status: FolderBackupStatus): FolderBackupStatus {
    setInternal(this.options.db, STATUS_KEY, status)
    return status
  }

  /** Escolhe (ou desliga, com `null`) a pasta; o histórico de envios recomeça. */
  async setFolder(path: string | null): Promise<FolderBackupStatus> {
    if (path !== null) {
      try {
        await checkFolder(path, this.options.timeoutMs)
      } catch (error) {
        throw new Error(folderErrorMessage(error), { cause: error })
      }
    }
    return this.save({ ...EMPTY_FOLDER_STATUS, path })
  }

  /** Hora de gravar: nunca gravou, a última tentativa falhou ou o último backup tem mais de ~20 h. */
  due(): boolean {
    const s = this.status()
    if (!s.path) return false
    if (s.error !== null || s.lastAt === null) return true
    return Math.floor(this.now.getTime() / 1000) - s.lastAt >= AUTO_INTERVAL_SEC
  }

  /** Algo mudou no banco desde o último backup na pasta (nesta sessão). */
  changed(): boolean {
    return totalChanges(this.options.db) > this.baseline
  }

  run(): Promise<FolderBackupStatus> {
    this.running ??= this.write().finally(() => (this.running = null))
    return this.running
  }

  private async write(): Promise<FolderBackupStatus> {
    const before = this.status()
    if (!before.path) return before
    const now = this.now
    const nowSec = Math.floor(now.getTime() / 1000)
    try {
      const { file } = await writeFolderBackup(this.options.db, before.path, this.options.tmpDir, now, this.options.timeoutMs)
      // A pasta pode ter sido trocada enquanto copiava: o resultado vale para a pasta usada.
      if (this.status().path !== before.path) return this.status()
      const status = this.save({ ...before, lastAt: nowSec, lastFile: file, error: null, errorAt: null, failingSince: null })
      this.baseline = totalChanges(this.options.db)
      return status
    } catch (error) {
      if (this.status().path !== before.path) return this.status()
      return this.save({ ...before, error: folderErrorMessage(error), errorAt: nowSec, failingSince: before.failingSince ?? nowSec })
    }
  }
}
