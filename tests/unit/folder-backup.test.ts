import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { folderBackupWarning, FOLDER_WARN_AFTER_SEC, EMPTY_FOLDER_STATUS } from '../../src/shared/backup'
import { openDatabase, type Database } from '../../src/main/db/database'
import { getInternal, setInternal } from '../../src/main/db/settings'
import { getDashboard } from '../../src/main/db/dashboard'
import { inspectBackup } from '../../src/main/backup/backup'
import { fetchFolderBackup, FolderBackup, listFolderBackups, writeFolderBackup } from '../../src/main/backup/folder'

let dir: string
let folder: string
let tmp: string
let db: Database

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tramotak-pasta-'))
  folder = join(dir, 'Drive', 'Tramotak')
  tmp = join(dir, 'backup-tmp')
  mkdirSync(folder, { recursive: true })
  db = openDatabase(join(dir, 'tramotak.db'))
  db.prepare("INSERT INTO courses (title, root_path, structure, numbering) VALUES ('Cálculo', '/cursos/calc', 'flat', 'dot')").run()
  setInternal(db, 'secret.ai.gemini', 'cifrado-deste-pc')
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const at = (iso: string) => new Date(iso)

describe('gravar na pasta escolhida', () => {
  it('grava o backup sem as chaves, sem deixar arquivo provisório nem a cópia intermediária', async () => {
    const { file } = await writeFolderBackup(db, folder, tmp, at('2026-10-16T14:30:00'))
    expect(file).toBe('Tramotak-auto-2026-10-16-1430.db')
    expect(readdirSync(folder)).toEqual([file])
    expect(readdirSync(tmp)).toEqual([])
    expect(inspectBackup(join(folder, file)).counts.courses).toBe(1)
    const copy = openDatabase(join(folder, file))
    expect(getInternal(copy, 'secret.ai.gemini')).toBeUndefined()
    copy.close()
  })

  it('guarda só os 7 automáticos mais novos e não mexe nos outros arquivos da pasta', async () => {
    for (let day = 1; day <= 9; day++) writeFileSync(join(folder, `Tramotak-auto-2026-10-0${day}-0800.db`), 'antigo')
    writeFileSync(join(folder, 'Tramotak-backup-2026-01-01-0000.db'), 'manual')
    writeFileSync(join(folder, 'minhas-fotos.jpg'), 'x')
    writeFileSync(join(folder, 'Tramotak-auto-2026-10-15-2200.db.partial'), 'resto de cópia interrompida')
    await writeFolderBackup(db, folder, tmp, at('2026-10-16T14:30:00'))
    const names = readdirSync(folder).sort()
    expect(names.filter((n) => n.startsWith('Tramotak-auto-'))).toEqual([
      'Tramotak-auto-2026-10-04-0800.db',
      'Tramotak-auto-2026-10-05-0800.db',
      'Tramotak-auto-2026-10-06-0800.db',
      'Tramotak-auto-2026-10-07-0800.db',
      'Tramotak-auto-2026-10-08-0800.db',
      'Tramotak-auto-2026-10-09-0800.db',
      'Tramotak-auto-2026-10-16-1430.db'
    ])
    expect(names).toContain('Tramotak-backup-2026-01-01-0000.db')
    expect(names).toContain('minhas-fotos.jpg')
  })

  it('pasta sumida dá erro claro e não é recriada no disco local', async () => {
    rmSync(join(dir, 'Drive'), { recursive: true })
    await expect(writeFolderBackup(db, folder, tmp)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(existsSync(folder)).toBe(false)
  })

  it('lista só os backups do Tramotak e copia um deles para a pasta do app', async () => {
    const { file } = await writeFolderBackup(db, folder, tmp, at('2026-10-16T14:30:00'))
    writeFileSync(join(folder, 'outra-coisa.db'), 'x')
    const listed = await listFolderBackups(folder)
    expect(listed.map((b) => [b.name, b.kind])).toEqual([[file, 'auto']])
    const copy = await fetchFolderBackup(folder, file, tmp)
    expect(inspectBackup(copy).counts.courses).toBe(1)
    await expect(fetchFolderBackup(folder, '../tramotak.db', tmp)).rejects.toThrow(/inválido/)
    await expect(fetchFolderBackup(folder, 'outra-coisa.db', tmp)).rejects.toThrow(/inválido/)
  })
})

describe('estado do backup na pasta', () => {
  it('sem pasta nada roda; com pasta grava, só volta a gravar depois de ~20 h e o fechar só grava se algo mudou', async () => {
    let now = at('2026-10-16T08:00:00')
    const backup = new FolderBackup({ db, tmpDir: tmp, now: () => now })
    expect(backup.due()).toBe(false)
    await backup.setFolder(folder)
    expect(backup.due()).toBe(true)
    const done = await backup.run()
    expect(done).toMatchObject({ path: folder, lastFile: 'Tramotak-auto-2026-10-16-0800.db', error: null, failingSince: null })
    expect(backup.changed()).toBe(false)
    now = at('2026-10-16T20:00:00')
    expect(backup.due()).toBe(false)
    now = at('2026-10-17T04:00:00')
    expect(backup.due()).toBe(true)
    db.prepare("UPDATE courses SET title = 'Cálculo I'").run()
    expect(backup.changed()).toBe(true)
  })

  it('falhas guardam o erro e quando começaram; o Início avisa depois de 3 dias; um sucesso limpa tudo', async () => {
    let now = at('2026-10-10T08:00:00')
    const backup = new FolderBackup({ db, tmpDir: tmp, now: () => now })
    await backup.setFolder(folder)
    rmSync(folder, { recursive: true })
    const first = await backup.run()
    expect(first.error).toMatch(/não foi encontrada/)
    const since = first.failingSince!
    expect(backup.due()).toBe(true)
    now = at('2026-10-12T08:00:00')
    expect((await backup.run()).failingSince).toBe(since)
    expect(getDashboard(db, now).backupWarning).toBeNull()
    now = at('2026-10-13T09:00:00')
    await backup.run()
    expect(getDashboard(db, now).backupWarning).toMatchObject({ since, days: 3 })
    mkdirSync(folder, { recursive: true })
    expect(await backup.run()).toMatchObject({ error: null, failingSince: null, lastFile: 'Tramotak-auto-2026-10-13-0900.db' })
    expect(getDashboard(db, now).backupWarning).toBeNull()
  })

  it('não aceita escolher uma pasta que não existe e desligar limpa o histórico', async () => {
    const backup = new FolderBackup({ db, tmpDir: tmp })
    await expect(backup.setFolder(join(dir, 'nao-existe'))).rejects.toThrow(/não foi encontrada/)
    await backup.setFolder(folder)
    await backup.run()
    expect(await backup.setFolder(null)).toEqual(EMPTY_FOLDER_STATUS)
    expect(backup.due()).toBe(false)
  })

  it('aviso só com pasta, erro e 3 dias de falha', () => {
    const base = { ...EMPTY_FOLDER_STATUS, path: '/p', error: 'x', failingSince: 1000 }
    expect(folderBackupWarning(base, 1000 + FOLDER_WARN_AFTER_SEC - 1)).toBe(false)
    expect(folderBackupWarning(base, 1000 + FOLDER_WARN_AFTER_SEC)).toBe(true)
    expect(folderBackupWarning({ ...base, path: null }, 1e12)).toBe(false)
    expect(folderBackupWarning({ ...base, error: null }, 1e12)).toBe(false)
  })
})
