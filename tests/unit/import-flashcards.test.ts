import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Database } from '../../src/main/db/database'
import { getDeck } from '../../src/main/db/flashcards'
import { htmlToText, splitCloze } from '../../src/main/importers/html'
import { importDeckFile, parseText } from '../../src/main/importers/flashcards'
import { listZip, readZipEntry } from '../../src/main/importers/zip'
import { makeZip } from '../helpers/zip'

let dir: string
let db: Database

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tramotak-import-'))
  db = openDatabase(':memory:')
})
afterEach(async () => {
  db.close()
  await rm(dir, { recursive: true, force: true })
})

type Note = string[]

/** Monta uma coleção do Anki no formato antigo (decks em JSON na tabela col). */
async function legacyCollection(notes: Note[], deckName = 'Biologia::Células'): Promise<Buffer> {
  const file = join(dir, `legacy-${Math.random()}.anki2`)
  const col = new DatabaseSync(file)
  col.exec(`CREATE TABLE col (id INTEGER PRIMARY KEY, decks TEXT, models TEXT);
            CREATE TABLE notes (id INTEGER PRIMARY KEY, mid INTEGER, flds TEXT);
            CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER);`)
  col.prepare('INSERT INTO col VALUES (1, ?, ?)').run(JSON.stringify({ 1: { name: 'Default' }, 42: { name: deckName } }), '{}')
  notes.forEach((fields, i) => {
    col.prepare('INSERT INTO notes VALUES (?, 1, ?)').run(i + 1, fields.join('\x1f'))
    col.prepare('INSERT INTO cards VALUES (?, ?, 42)').run(i + 1, i + 1)
  })
  col.close()
  return readFile(file)
}

/** Formato novo (Anki 2.1.50+): tabela decks com o separador \x1f nos subbaralhos. */
async function modernCollection(notes: Note[]): Promise<Buffer> {
  const file = join(dir, `modern-${Math.random()}.anki21b`)
  const col = new DatabaseSync(file)
  col.exec(`CREATE TABLE decks (id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE notes (id INTEGER PRIMARY KEY, mid INTEGER, flds TEXT);
            CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER);`)
  col.prepare('INSERT INTO decks VALUES (7, ?)').run('Idiomas\x1fInglês')
  notes.forEach((fields, i) => {
    col.prepare('INSERT INTO notes VALUES (?, 1, ?)').run(i + 1, fields.join('\x1f'))
    col.prepare('INSERT INTO cards VALUES (?, ?, 7)').run(i + 1, i + 1)
  })
  col.close()
  return readFile(file)
}

async function writeApkg(name: string, files: Parameters<typeof makeZip>[0]): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, makeZip(files))
  return path
}

describe('zip', () => {
  it('lê entradas guardadas e comprimidas', () => {
    const zip = makeZip([
      { name: 'a.txt', data: Buffer.from('olá') },
      { name: 'pasta/b.txt', data: Buffer.from('x'.repeat(1000)), deflate: true }
    ])
    const entries = listZip(zip)
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'pasta/b.txt'])
    expect(readZipEntry(zip, entries[0]).toString()).toBe('olá')
    expect(readZipEntry(zip, entries[1]).toString()).toBe('x'.repeat(1000))
  })

  it('recusa arquivos que não são ZIP', () => {
    expect(() => listZip(Buffer.from('não sou um zip, sou só texto comprido o bastante'))).toThrow('ZIP')
  })
})

describe('conversão do HTML do Anki', () => {
  it('quebras de linha, entidades, imagens e áudio', () => {
    expect(htmlToText('<div>Linha 1</div><div>Linha&nbsp;2<br>3 &lt; 4 &amp; &#233;</div>')).toBe('Linha 1\nLinha 2\n3 < 4 & é')
    expect(htmlToText('Veja <img src="a.png"> e [sound:x.mp3]')).toBe('Veja [imagem] e [áudio]')
    expect(htmlToText('<ul><li>a</li><li>b</li></ul>')).toBe('• a\n• b')
    expect(htmlToText('<script>alert(1)</script>ok')).toBe('ok')
  })

  it('cloze vira pergunta e resposta', () => {
    expect(splitCloze('A capital é {{c1::Brasília::cidade}}.')).toEqual({ front: 'A capital é [cidade].', back: 'A capital é Brasília.' })
    expect(splitCloze('{{c1::H}} e {{c2::O}}')).toEqual({ front: '[…] e […]', back: 'H e O' })
    expect(splitCloze('sem cloze')).toBeNull()
  })
})

describe('importar .apkg', () => {
  it('formato antigo: usa o nome do baralho, converte HTML e pula repetidas e vazias', async () => {
    const collection = await legacyCollection([
      ['Organela da respiração?', '<b>Mitocôndria</b>'],
      ['Organela da respiração?', '<b>Mitocôndria</b>'],
      ['', 'sem frente'],
      ['A célula vegetal tem {{c1::parede celular}}', 'extra']
    ])
    const path = await writeApkg('bio.apkg', [{ name: 'collection.anki2', data: collection, deflate: true }, { name: 'media', data: Buffer.from('{}') }])

    const result = await importDeckFile(db, path)
    expect(result).toMatchObject({ deckTitle: 'Biologia › Células', imported: 2, skipped: 1 })
    expect(getDeck(db, result.deckId).cards.map((c) => [c.front, c.back, c.state])).toEqual([
      ['Organela da respiração?', 'Mitocôndria', 'new'],
      ['A célula vegetal tem […]', 'A célula vegetal tem parede celular\n\nextra', 'new']
    ])
  })

  it('formato novo (anki21b, zstd) tem prioridade sobre o anki2 de compatibilidade', async () => {
    const stub = await legacyCollection([['Atualize o Anki', '']], 'Default')
    const modern = zstdCompressSync(await modernCollection([['apple', 'maçã'], ['book', 'livro']]))
    const path = await writeApkg('idiomas.apkg', [
      { name: 'collection.anki2', data: stub },
      { name: 'collection.anki21b', data: modern }
    ])
    const result = await importDeckFile(db, path)
    expect(result).toMatchObject({ deckTitle: 'Idiomas › Inglês', imported: 2 })
  })

  it('sem nome de baralho usa o nome do arquivo', async () => {
    const collection = await legacyCollection([['a', 'b']], 'Default')
    const path = await writeApkg('Minhas cartas.apkg', [{ name: 'collection.anki2', data: collection }])
    expect((await importDeckFile(db, path)).deckTitle).toBe('Minhas cartas')
  })

  it('pacote sem coleção ou vazio dá erro claro', async () => {
    const empty = await writeApkg('vazio.apkg', [{ name: 'media', data: Buffer.from('{}') }])
    await expect(importDeckFile(db, empty)).rejects.toThrow('sem coleção')
    const none = await writeApkg('nenhuma.apkg', [{ name: 'collection.anki2', data: await legacyCollection([]) }])
    await expect(importDeckFile(db, none)).rejects.toThrow('Nenhuma carta')
  })
})

describe('importar texto', () => {
  it('tab (exportação do Anki) com cabeçalhos ignorados', () => {
    expect(parseText('#separator:tab\n#html:true\nfrente\t<i>verso</i>\n\n2 + 2\t4\n', 'X').cards).toEqual([
      { front: 'frente', back: 'verso' },
      { front: '2 + 2', back: '4' }
    ])
  })

  it('ponto e vírgula quando não há tab, e "<" em texto puro não some', () => {
    expect(parseText('a < b;verdadeiro\nsó frente', 'X').cards).toEqual([
      { front: 'a < b', back: 'verdadeiro' },
      { front: 'só frente', back: '' }
    ])
  })

  it('arquivo .txt pelo importador', async () => {
    const path = join(dir, 'vocabulario.txt')
    await writeFile(path, 'casa\thouse\ncão\tdog\n')
    expect(await importDeckFile(db, path)).toMatchObject({ deckTitle: 'vocabulario', imported: 2 })
  })

  it('formato desconhecido', async () => {
    const path = join(dir, 'x.docx')
    await writeFile(path, 'x')
    await expect(importDeckFile(db, path)).rejects.toThrow('não suportado')
  })
})
