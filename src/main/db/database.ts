import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from './migrations'

export type Database = DatabaseSync

/** Abre (ou cria) o banco, liga as pragmas e aplica as migrations pendentes. */
export function openDatabase(path: string): Database {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  migrate(db)
  return db
}

export function schemaVersion(db: Database): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
}

export function migrate(db: Database): void {
  const current = schemaVersion(db)
  for (let version = current + 1; version <= MIGRATIONS.length; version++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[version - 1])
      db.exec(`PRAGMA user_version = ${version}`)
    })
  }
}

const depth = new WeakMap<Database, number>()

/**
 * Executa `fn` numa transação; desfaz tudo se lançar erro.
 * Chamadas aninhadas viram SAVEPOINTs: um erro interno desfaz só a parte interna.
 */
export function transaction<T>(db: Database, fn: () => T): T {
  const level = depth.get(db) ?? 0
  const savepoint = `sp_${level}`
  db.exec(level === 0 ? 'BEGIN' : `SAVEPOINT ${savepoint}`)
  depth.set(db, level + 1)
  try {
    const result = fn()
    db.exec(level === 0 ? 'COMMIT' : `RELEASE ${savepoint}`)
    return result
  } catch (error) {
    db.exec(level === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`)
    throw error
  } finally {
    depth.set(db, level)
  }
}
