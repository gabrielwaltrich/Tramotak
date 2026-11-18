import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Database } from '../../src/main/db/database'
import { answerCard, createCard, createDeck } from '../../src/main/db/flashcards'
import { buildApkg, buildText, fieldChecksum, loadExport } from '../../src/main/exporters/anki'
import { parseApkg, parseText } from '../../src/main/importers/flashcards'
import { listZip, readZipEntry } from '../../src/main/importers/zip'

let dir: string
let db: Database
let deckId: number
let other: number
const now = Math.floor(new Date('2026-10-17T10:00:00').getTime() / 1000)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tramotak-anki-'))
  db = openDatabase(':memory:')
  deckId = createDeck(db, { title: 'Docker' })
  other = createDeck(db, { title: 'Redes::TCP' })
  createCard(db, { deckId, front: 'O que é uma imagem?', back: 'Um modelo <somente leitura>\ncom camadas.' })
  const reviewed = createCard(db, { deckId, front: 'Porta padrão do HTTP?', back: '80' })
  const learning = createCard(db, { deckId, front: 'Comando para listar contêineres?', back: 'docker ps' })
  createCard(db, { deckId: other, front: 'O que faz o handshake?', back: 'Abre a conexão' })
  // Uma carta vira revisão (Bom, Fácil) e outra fica aprendendo (Errei).
  answerCard(db, reviewed.id, 3, 4000, now - 3 * 86_400, () => 0.5)
  answerCard(db, reviewed.id, 4, 3000, now - 2 * 86_400, () => 0.5)
  answerCard(db, learning.id, 1, 9000, now - 60, () => 0.5)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

async function openCollection(buf: Buffer) {
  const entries = listZip(buf)
  expect(entries.map((e) => e.name)).toEqual(['collection.anki2', 'media'])
  const file = join(dir, 'c.anki2')
  writeFileSync(file, readZipEntry(buf, entries[0]))
  return new DatabaseSync(file, { readOnly: true })
}

describe('exportar para o Anki', () => {
  it('.apkg com os baralhos, as notas de 3 campos e o agendamento', async () => {
    const data = loadExport(db, [deckId, other])
    const buf = await buildApkg(data, { includeSchedule: true, installId: 'teste', now })
    // Para o validador com a biblioteca oficial do Anki (fora do repositório).
    if (process.env.TRAMOTAK_APKG_OUT) writeFileSync(process.env.TRAMOTAK_APKG_OUT, buf)
    const col = await openCollection(buf)
    try {
      expect((col.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(11)
      const decks = JSON.parse((col.prepare('SELECT decks FROM col').get() as { decks: string }).decks) as Record<string, { name: string }>
      expect(Object.values(decks).map((d) => d.name).sort()).toEqual(['Default', 'Docker', 'Redes › TCP'])
      const notes = col.prepare('SELECT flds, csum, tags FROM notes ORDER BY id').all() as { flds: string; csum: number; tags: string }[]
      expect(notes).toHaveLength(4)
      expect(notes[0].flds.split('\x1f')).toEqual(['O que é uma imagem?', 'Um modelo &lt;somente leitura&gt;<br>com camadas.', ''])
      expect(notes[0].csum).toBe(fieldChecksum('O que é uma imagem?'))
      expect(notes[0].tags.trim()).toBe('Tramotak')
      const cards = col.prepare('SELECT type, queue, due, ivl, reps FROM cards ORDER BY id').all() as { type: number; queue: number; due: number; ivl: number; reps: number }[]
      expect(cards[0]).toMatchObject({ type: 0, queue: 0 }) // nova
      expect(cards[1]).toMatchObject({ type: 2, queue: 2, reps: 2 }) // revisão: dia relativo a hoje
      expect(cards[1].ivl).toBeGreaterThanOrEqual(1)
      expect(cards[2]).toMatchObject({ type: 1, queue: 1 }) // aprendendo: vence por horário
      expect(cards[2].due).toBeGreaterThan(now - 60)
      expect((col.prepare('SELECT COUNT(*) AS n FROM revlog').get() as { n: number }).n).toBe(3)
    } finally {
      col.close()
    }
    // O próprio importador do Tramotak lê o pacote de volta.
    const file = join(dir, 'x.apkg')
    writeFileSync(file, buf)
    const parsed = await parseApkg(file)
    expect(parsed.cards.map((c) => c.front)).toContain('Porta padrão do HTTP?')
  })

  it('sem o agendamento, todas entram como novas e sem histórico', async () => {
    const col = await openCollection(await buildApkg(loadExport(db, [deckId]), { includeSchedule: false, installId: 'teste', now }))
    try {
      expect((col.prepare('SELECT DISTINCT type, queue FROM cards').all() as object[])).toEqual([{ type: 0, queue: 0 }])
      expect((col.prepare('SELECT COUNT(*) AS n FROM revlog').get() as { n: number }).n).toBe(0)
    } finally {
      col.close()
    }
  })

  it('a fonte diz curso, módulo, aula e minuto', async () => {
    const courseId = Number(db.prepare("INSERT INTO courses (title, root_path, structure, numbering) VALUES ('DevOps', '/c', 'modules', 'dot')").run().lastInsertRowid)
    const moduleId = Number(db.prepare("INSERT INTO modules (course_id, title, rel_path, position) VALUES (?, 'Docker', 'm', 0)").run(courseId).lastInsertRowid)
    const lessonId = Number(
      db.prepare("INSERT INTO lessons (course_id, module_id, title, rel_path, kind, position, file_size, mtime_ms) VALUES (?, ?, 'Imagens', 'm/a.mp4', 'video', 0, 1, 1)").run(courseId, moduleId).lastInsertRowid
    )
    createCard(db, { deckId, front: 'Camada?', back: 'Sim', lessonId, timestampSec: 754 })
    const data = loadExport(db, [deckId])
    expect(data.cards.at(-1)!.source).toBe('DevOps › Docker › Imagens · 12:34')
  })

  it('texto com os cabeçalhos do Anki, lido de volta pelo importador', () => {
    const text = buildText(loadExport(db, [deckId, other]))
    if (process.env.TRAMOTAK_TXT_OUT) writeFileSync(process.env.TRAMOTAK_TXT_OUT, text)
    expect(text.split('\n').slice(0, 4)).toEqual(['#separator:tab', '#html:true', '#deck column:4', '#tags column:5'])
    expect(text).toContain('O que faz o handshake?\tAbre a conexão\t\tRedes › TCP\tTramotak')
    const back = parseText(text, 'x').cards
    expect(back).toHaveLength(4)
    expect(back.find((c) => c.front === 'O que faz o handshake?')?.back).toBe('Abre a conexão')
  })

  it('recusa lista vazia ou baralho que não existe', () => {
    expect(() => loadExport(db, [])).toThrow(/Escolha/)
    expect(() => loadExport(db, [9999])).toThrow(/não encontrado/)
  })
})
