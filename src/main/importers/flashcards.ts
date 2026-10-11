import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { zstdDecompressSync } from 'node:zlib'
import { MAX_CARD_FIELD, type ImportResult } from '@shared/flashcards'
import { transaction, type Database } from '../db/database'
import { createDeck } from '../db/flashcards'
import { htmlToText, splitCloze } from './html'
import { listZip, readZipEntry } from './zip'

export interface ParsedDeck {
  title: string
  cards: { front: string; back: string }[]
}

const MAX_FILE_BYTES = 512 * 1024 * 1024
/** Separador de campos das notas do Anki. */
const FIELD_SEPARATOR = '\x1f'

function fileTitle(path: string): string {
  return basename(path, extname(path)).trim() || 'Baralho importado'
}

function cardFromFields(fields: string[]): { front: string; back: string } | null {
  const [first = '', second = ''] = fields.map(htmlToText)
  const cloze = splitCloze(first)
  const front = cloze ? cloze.front : first
  const back = cloze ? [cloze.back, second].filter(Boolean).join('\n\n') : second
  if (!front.trim()) return null
  return { front: front.slice(0, MAX_CARD_FIELD), back: back.slice(0, MAX_CARD_FIELD) }
}

/** Nome do baralho onde está a maioria das cartas (formatos antigo e novo do Anki). */
function mainDeckName(collection: DatabaseSync): string | null {
  const top = collection.prepare('SELECT did, COUNT(*) AS n FROM cards GROUP BY did ORDER BY n DESC LIMIT 1').get() as
    | { did: number }
    | undefined
  if (!top) return null
  const hasDecksTable = collection.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'decks'").get()
  let name: string | undefined
  if (hasDecksTable) {
    name = (collection.prepare('SELECT name FROM decks WHERE id = ?').get(top.did) as { name: string } | undefined)?.name
  } else {
    const col = collection.prepare('SELECT decks FROM col').get() as { decks: string } | undefined
    name = col ? (JSON.parse(col.decks) as Record<string, { name: string }>)[String(top.did)]?.name : undefined
  }
  if (!name || name === 'Default' || name === 'Padrão') return null
  // Subbaralhos usam "Pai::Filho" (o formato novo usa o separador \x1f).
  return name.replaceAll('\x1f', '::').split('::').join(' › ')
}

/** Lê um pacote .apkg. Prefere o banco mais novo: anki21b (zstd) > anki21 > anki2. */
export async function parseApkg(path: string): Promise<ParsedDeck> {
  const buf = await readFile(path)
  if (buf.length > MAX_FILE_BYTES) throw new Error('Arquivo grande demais para importar')
  const entries = listZip(buf)
  const pick = (name: string) => entries.find((e) => e.name === name)
  const entry = pick('collection.anki21b') ?? pick('collection.anki21') ?? pick('collection.anki2')
  if (!entry) throw new Error('Pacote do Anki sem coleção (collection.anki2)')

  let bytes = readZipEntry(buf, entry)
  if (entry.name.endsWith('anki21b')) bytes = zstdDecompressSync(bytes)

  // node:sqlite só abre arquivos: grava a coleção numa pasta temporária.
  const dir = await mkdtemp(join(tmpdir(), 'tramotak-apkg-'))
  const file = join(dir, 'collection.sqlite')
  try {
    await writeFile(file, bytes)
    const collection = new DatabaseSync(file, { readOnly: true })
    try {
      const notes = collection.prepare('SELECT flds FROM notes ORDER BY id').all() as { flds: string }[]
      const cards = notes.map((n) => cardFromFields(n.flds.split(FIELD_SEPARATOR))).filter((c) => c !== null)
      return { title: mainDeckName(collection) ?? fileTitle(path), cards }
    } finally {
      collection.close()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Texto com uma carta por linha: "frente<TAB>verso" (exportação do Anki) ou "frente;verso".
 * Linhas começando com "#" são cabeçalhos do Anki e são ignoradas.
 */
export function parseText(content: string, title: string): ParsedDeck {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/)
  const useTab = lines.some((l) => l.includes('\t'))
  const separator = useTab ? '\t' : ';'
  const cards: ParsedDeck['cards'] = []
  for (const line of lines) {
    if (!line.trim() || line.startsWith('#')) continue
    const [front = '', ...rest] = line.split(separator)
    const card = cardFromFields(/<[a-z]/i.test(line) ? [front, rest.join(separator)] : [escapeHtml(front), escapeHtml(rest.join(separator))])
    if (card) cards.push(card)
  }
  return { title, cards }
}

/** Texto puro passa pelo mesmo conversor do HTML; escapar evita que "<" vire tag. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function parseDeckFile(path: string): Promise<ParsedDeck> {
  const ext = extname(path).toLowerCase()
  if (ext === '.apkg' || ext === '.colpkg') return parseApkg(path)
  if (ext === '.txt' || ext === '.tsv' || ext === '.csv') {
    const info = await readFile(path)
    if (info.length > MAX_FILE_BYTES) throw new Error('Arquivo grande demais para importar')
    return parseText(info.toString('utf8'), fileTitle(path))
  }
  throw new Error('Formato não suportado. Use .apkg (Anki), .txt ou .tsv')
}

/** Cria um baralho novo com as cartas do arquivo (como cartas novas). Repetidas são puladas. */
export async function importDeckFile(db: Database, path: string): Promise<ImportResult> {
  const parsed = await parseDeckFile(path)
  if (parsed.cards.length === 0) throw new Error('Nenhuma carta encontrada no arquivo')

  return transaction(db, () => {
    const deckId = createDeck(db, { title: parsed.title })
    const insert = db.prepare('INSERT INTO cards (deck_id, front, back) VALUES (?, ?, ?)')
    const seen = new Set<string>()
    let imported = 0
    for (const card of parsed.cards) {
      const key = `${card.front}\x00${card.back}`
      if (seen.has(key)) continue
      seen.add(key)
      insert.run(deckId, card.front, card.back)
      imported++
    }
    return { deckId, deckTitle: parsed.title, imported, skipped: parsed.cards.length - imported }
  })
}
