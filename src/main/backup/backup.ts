import { copyFileSync, existsSync, mkdirSync, openSync, readSync, closeSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { BackupEntry, BackupInfo } from '@shared/backup'
import { MIGRATIONS } from '../db/migrations'
import type { Database } from '../db/database'

export const PENDING_RESTORE = 'restore-pending.db'
export const AUTO_KEEP = 7
/** Um backup automático por dia; a folga cobre o app aberto sempre no mesmo horário. */
export const AUTO_INTERVAL_SEC = 20 * 3600

const pad = (n: number) => String(n).padStart(2, '0')

/** 2026-10-11-1430 (horário local), para nomes de arquivo. */
export function stamp(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
}

/**
 * Cópia consistente do banco (VACUUM INTO funciona com o banco aberto e em uso) sem as chaves de API:
 * elas só se decifram neste computador e não devem sair dele num arquivo.
 */
export function createBackup(db: Database, dest: string): { path: string; bytes: number } {
  rmSync(dest, { force: true })
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`)
  const copy = new DatabaseSync(dest)
  try {
    copy.exec("DELETE FROM settings WHERE key LIKE 'internal.secret.%'")
    copy.exec('VACUUM')
  } finally {
    copy.close()
  }
  return { path: dest, bytes: statSync(dest).size }
}

function hasSqliteHeader(path: string): boolean {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(16)
    readSync(fd, buf, 0, 16, 0)
    return buf.toString('latin1') === 'SQLite format 3\0'
  } finally {
    closeSync(fd)
  }
}

const count = (db: DatabaseSync, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

/** Confere se o arquivo é um banco do Tramotak que esta versão consegue abrir e resume o conteúdo. */
export function inspectBackup(path: string): BackupInfo {
  if (!existsSync(path)) throw new Error('Arquivo não encontrado')
  if (!hasSqliteHeader(path)) throw new Error('Este arquivo não é um backup do Tramotak')
  let db: DatabaseSync
  try {
    db = new DatabaseSync(path, { readOnly: true })
  } catch {
    throw new Error('Não foi possível abrir o backup')
  }
  try {
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name))
    if (!tables.has('courses') || !tables.has('settings') || !tables.has('lessons')) throw new Error('Este arquivo não é um backup do Tramotak')
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    if (version > MIGRATIONS.length) throw new Error('Backup feito por uma versão mais nova do Tramotak. Atualize o app para restaurá-lo.')
    const check = (db.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check
    if (check !== 'ok') throw new Error('O backup está corrompido')
    const optional = (table: string) => (tables.has(table) ? count(db, table) : 0)
    return {
      path,
      name: basename(path),
      bytes: statSync(path).size,
      modifiedAt: Math.floor(statSync(path).mtimeMs / 1000),
      schemaVersion: version,
      counts: {
        courses: count(db, 'courses'),
        lessons: count(db, 'lessons'),
        notes: optional('notes'),
        cards: optional('cards'),
        questions: optional('questions'),
        pages: optional('notebook_pages'),
        mindmaps: optional('mindmaps')
      }
    }
  } finally {
    db.close()
  }
}

/** Deixa o backup pronto para entrar no lugar do banco no próximo início do app. */
export function stageRestore(userData: string, source: string): BackupInfo {
  const info = inspectBackup(source)
  copyFileSync(source, join(userData, PENDING_RESTORE))
  return info
}

/**
 * Chamado antes de abrir o banco. Se houver restauração pendente, guarda o banco atual em
 * `backups/antes-de-restaurar-…` e põe o backup no lugar. Devolve se restaurou.
 */
export function applyPendingRestore(userData: string, dbPath: string, backupsDir: string): boolean {
  const pending = join(userData, PENDING_RESTORE)
  if (!existsSync(pending)) return false
  try {
    inspectBackup(pending)
  } catch {
    rmSync(pending, { force: true })
    return false
  }
  mkdirSync(backupsDir, { recursive: true })
  // As chaves de API não vão nos backups; as deste computador continuam valendo depois de restaurar.
  let secrets: { key: string; value: string }[] = []
  if (existsSync(dbPath)) {
    const current = new DatabaseSync(dbPath)
    try {
      const safety = join(backupsDir, `antes-de-restaurar-${stamp()}.db`)
      rmSync(safety, { force: true })
      current.exec(`VACUUM INTO '${safety.replace(/'/g, "''")}'`)
      secrets = current.prepare("SELECT key, value_json AS value FROM settings WHERE key LIKE 'internal.secret.%'").all() as typeof secrets
    } finally {
      current.close()
    }
  }
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true })
  renameSync(pending, dbPath)
  if (secrets.length) {
    const restored = new DatabaseSync(dbPath)
    try {
      const upsert = restored.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json')
      for (const s of secrets) upsert.run(s.key, s.value)
    } finally {
      restored.close()
    }
  }
  return true
}

function kindOf(name: string): BackupEntry['kind'] {
  if (name.startsWith('auto-')) return 'auto'
  if (name.startsWith('antes-de-restaurar-')) return 'pre-restore'
  return 'manual'
}

export function listBackups(backupsDir: string): BackupEntry[] {
  if (!existsSync(backupsDir)) return []
  return readdirSync(backupsDir)
    .filter((name) => name.endsWith('.db'))
    .map((name) => {
      const info = statSync(join(backupsDir, name))
      return { name, bytes: info.size, modifiedAt: Math.floor(info.mtimeMs / 1000), kind: kindOf(name) }
    })
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
}

/** Caminho de um backup da pasta do app pelo nome, sem sair dela. */
export function backupPath(backupsDir: string, name: string): string {
  if (typeof name !== 'string' || name !== basename(name) || !name.endsWith('.db')) throw new Error('Backup inválido')
  return join(backupsDir, name)
}

/**
 * Faz o backup automático do dia se o último tiver mais de ~20 h e mantém só os 7 mais recentes
 * (os manuais e os de antes de restaurar não são apagados). Devolve o arquivo criado, se houver.
 */
export function autoBackup(db: Database, backupsDir: string, lastAt: number | null, now = new Date()): string | null {
  const nowSec = Math.floor(now.getTime() / 1000)
  if (lastAt !== null && nowSec - lastAt < AUTO_INTERVAL_SEC) return null
  mkdirSync(backupsDir, { recursive: true })
  const dest = join(backupsDir, `auto-${stamp(now)}.db`)
  createBackup(db, dest)
  const autos = listBackups(backupsDir).filter((b) => b.kind === 'auto')
  for (const old of autos.slice(AUTO_KEEP)) rmSync(join(backupsDir, old.name), { force: true })
  return dest
}
