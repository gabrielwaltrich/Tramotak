import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Database } from '../../src/main/db/database'
import { getInternal, setInternal } from '../../src/main/db/settings'
import { applyPendingRestore, autoBackup, backupPath, createBackup, inspectBackup, listBackups, stageRestore } from '../../src/main/backup/backup'
import { MIGRATIONS } from '../../src/main/db/migrations'

let dir: string
let db: Database

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tramotak-bkp-'))
  db = openDatabase(join(dir, 'tramotak.db'))
  db.prepare("INSERT INTO courses (title, root_path, structure, numbering) VALUES ('Cálculo', '/cursos/calc', 'flat', 'dot')").run()
  db.prepare("INSERT INTO decks (title) VALUES ('Inglês')").run()
  setInternal(db, 'secret.ai.gemini', 'cifrado-deste-pc')
})

afterEach(() => {
  try {
    db.close()
  } catch {
    // já fechado
  }
  rmSync(dir, { recursive: true, force: true })
})

describe('backup do banco', () => {
  it('cria cópia consistente sem as chaves de API e inspeciona o conteúdo', () => {
    const dest = join(dir, 'meu-backup.db')
    const { bytes } = createBackup(db, dest)
    expect(bytes).toBeGreaterThan(0)
    const info = inspectBackup(dest)
    expect(info.counts).toMatchObject({ courses: 1, lessons: 0, cards: 0 })
    expect(info.schemaVersion).toBe(MIGRATIONS.length)
    const copy = openDatabase(dest)
    expect(getInternal(copy, 'secret.ai.gemini')).toBeUndefined()
    copy.close()
  })

  it('recusa arquivos que não são backup do Tramotak ou de versão mais nova', () => {
    const fake = join(dir, 'falso.db')
    writeFileSync(fake, 'não sou sqlite')
    expect(() => inspectBackup(fake)).toThrow(/não é um backup/)
    const other = join(dir, 'outro.db')
    const foreign = new DatabaseSync(other)
    foreign.exec('CREATE TABLE x (a)')
    foreign.close()
    expect(() => inspectBackup(other)).toThrow(/não é um backup/)
    const future = join(dir, 'futuro.db')
    createBackup(db, future)
    const f = new DatabaseSync(future)
    f.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`)
    f.close()
    expect(() => inspectBackup(future)).toThrow(/versão mais nova/)
  })

  it('restauração pendente troca o banco no início, guarda o atual e mantém as chaves deste computador', () => {
    const backup = join(dir, 'antigo.db')
    createBackup(db, backup)
    db.prepare("INSERT INTO courses (title, root_path, structure, numbering) VALUES ('Depois do backup', '/x', 'flat', 'dot')").run()
    stageRestore(dir, backup)
    db.close()

    const backups = join(dir, 'backups')
    expect(applyPendingRestore(dir, join(dir, 'tramotak.db'), backups)).toBe(true)
    db = openDatabase(join(dir, 'tramotak.db'))
    expect((db.prepare('SELECT COUNT(*) AS n FROM courses').get() as { n: number }).n).toBe(1)
    expect(getInternal(db, 'secret.ai.gemini')).toBe('cifrado-deste-pc')
    const saved = listBackups(backups)
    expect(saved).toHaveLength(1)
    expect(saved[0].kind).toBe('pre-restore')
    expect(inspectBackup(join(backups, saved[0].name)).counts.courses).toBe(2)
    // Sem pendência, não faz nada
    expect(applyPendingRestore(dir, join(dir, 'tramotak.db'), backups)).toBe(false)
  })

  it('pendência inválida é descartada sem tocar no banco', () => {
    writeFileSync(join(dir, 'restore-pending.db'), 'lixo')
    expect(applyPendingRestore(dir, join(dir, 'tramotak.db'), join(dir, 'backups'))).toBe(false)
    expect(existsSync(join(dir, 'restore-pending.db'))).toBe(false)
  })

  it('backup automático: no máximo um a cada ~20 h e só os 7 mais recentes', () => {
    const backups = join(dir, 'backups')
    const day = (d: number) => new Date(2026, 9, d, 9, 0)
    let last: number | null = null
    for (let d = 1; d <= 10; d++) {
      const file = autoBackup(db, backups, last, day(d))
      expect(file).not.toBeNull()
      // mtime alinhado à data simulada, para a ordem por data valer
      utimesSync(file!, day(d), day(d))
      last = Math.floor(day(d).getTime() / 1000)
      expect(autoBackup(db, backups, last, new Date(day(d).getTime() + 3600_000))).toBeNull()
    }
    createBackup(db, join(backups, 'manual.db'))
    const autos = listBackups(backups).filter((b) => b.kind === 'auto')
    expect(autos).toHaveLength(7)
    expect(autos[0].name).toBe('auto-2026-10-10-0900.db')
    expect(listBackups(backups).some((b) => b.kind === 'manual')).toBe(true)
  })

  it('nome de backup não escapa da pasta', () => {
    expect(() => backupPath('/dados/backups', '../tramotak.db')).toThrow(/inválido/)
    expect(() => backupPath('/dados/backups', 'x.txt')).toThrow(/inválido/)
    expect(backupPath('/dados/backups', 'auto-2026-10-10-0900.db')).toBe(join('/dados/backups', 'auto-2026-10-10-0900.db'))
  })
})
