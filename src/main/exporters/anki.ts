import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { DeckExportRequest } from '@shared/flashcards'
import { formatClock } from '@shared/format'
import type { Database } from '../db/database'
import { writeZip } from '../importers/zip'

/**
 * Exportar baralhos para o Anki: `.apkg` no formato clássico (`collection.anki2`, esquema 11), que o Anki, o AnkiDroid
 * e o AnkiMobile importam, ou texto separado por tabulação com os cabeçalhos do Anki. Cada carta vira uma nota de três
 * campos (Frente, Verso, Fonte); a Fonte diz curso, módulo, aula e minuto, e fica embaixo do verso.
 */

/** Ids fixos: exportar de novo reaproveita o tipo de nota no Anki em vez de criar "Tramotak+". */
const MODEL_ID = 1_729_170_000_001
const DECK_ID_BASE = 1_729_170_000_000_000
const DAY = 86_400

export interface ExportCard {
  id: number
  deckId: number
  front: string
  back: string
  source: string
  state: 'new' | 'learning' | 'review' | 'relearning'
  due: number
  intervalDays: number
  ease: number
  reps: number
  lapses: number
  stability: number | null
  difficulty: number | null
  lastReviewAt: number | null
}

export interface ExportReview {
  cardId: number
  at: number
  rating: number
  stateBefore: string
  intervalBefore: number
  intervalAfter: number
  ease: number
  durationMs: number
}

export interface ExportData {
  decks: { id: number; title: string }[]
  cards: ExportCard[]
  reviews: ExportReview[]
}

/** Lê do banco os baralhos escolhidos, as cartas (com a aula de origem) e o histórico. */
export function loadExport(db: Database, deckIds: number[]): ExportData {
  const ids = [...new Set(deckIds.filter(Number.isInteger))]
  if (!ids.length) throw new Error('Escolha pelo menos um baralho')
  const marks = ids.map(() => '?').join(',')
  const decks = db.prepare(`SELECT id, title FROM decks WHERE id IN (${marks}) ORDER BY title`).all(...ids) as { id: number; title: string }[]
  if (decks.length !== ids.length) throw new Error('Baralho não encontrado')
  const rows = db
    .prepare(
      `SELECT k.id, k.deck_id AS deckId, k.front, k.back, k.state, k.due, k.interval_days AS intervalDays, k.ease, k.reps, k.lapses,
              k.stability, k.difficulty, k.last_review_at AS lastReviewAt, k.timestamp_sec AS timestampSec, l.title AS lesson, m.title AS module, c.title AS course
         FROM cards k
         LEFT JOIN lessons l ON l.id = k.lesson_id
         LEFT JOIN modules m ON m.id = l.module_id
         LEFT JOIN courses c ON c.id = l.course_id
        WHERE k.deck_id IN (${marks})
        ORDER BY k.deck_id, k.id`
    )
    .all(...ids) as (Omit<ExportCard, 'source'> & { timestampSec: number | null; lesson: string | null; module: string | null; course: string | null })[]
  const cards = rows.map(({ timestampSec, lesson, module, course, ...card }) => ({
    ...card,
    source: lesson ? [course, module, lesson].filter(Boolean).join(' › ') + (timestampSec !== null ? ` · ${formatClock(timestampSec)}` : '') : ''
  }))
  const reviews = db
    .prepare(
      `SELECT r.card_id AS cardId, r.reviewed_at AS at, r.rating, r.state_before AS stateBefore, r.interval_before AS intervalBefore,
              r.interval_after AS intervalAfter, r.ease_after AS ease, r.duration_ms AS durationMs
         FROM reviews r JOIN cards k ON k.id = r.card_id
        WHERE k.deck_id IN (${marks})
        ORDER BY r.reviewed_at, r.id`
    )
    .all(...ids) as unknown as ExportReview[]
  return { decks, cards, reviews }
}

/** Texto da carta como HTML do Anki: escapado, com as quebras de linha como <br>. */
export const toAnkiHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>')

const stripHtml = (html: string) =>
  html
    .replace(/<br>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()

/** Soma de verificação do primeiro campo, como o Anki calcula (detecta notas repetidas). */
export const fieldChecksum = (text: string) => parseInt(createHash('sha1').update(stripHtml(text)).digest('hex').slice(0, 8), 16)

/** GUID estável por carta (exportar de novo atualiza a nota no Anki em vez de duplicar). */
const guidFor = (installId: string, cardId: number) => createHash('sha1').update(`tramotak:${installId}:${cardId}`).digest('base64').slice(0, 10)

const startOfDay = (sec: number) => {
  const d = new Date(sec * 1000)
  d.setHours(0, 0, 0, 0)
  return Math.floor(d.getTime() / 1000)
}

/**
 * Agendamento no formato do Anki. Nova: posição na fila. Aprendendo (vence hoje): horário em segundos. Revisão ou
 * aprendizado de mais de um dia: dia relativo à criação da coleção (`crt` = começo de hoje, então hoje = 0). O FSRS do
 * Anki recalcula a memória pelo histórico (revlog); `data` leva a estabilidade e a dificuldade para quem já usa o FSRS.
 */
export function ankiSchedule(card: ExportCard, position: number, now: number, includeSchedule: boolean) {
  const base = { type: 0, queue: 0, due: position, ivl: 0, factor: 0, reps: 0, lapses: 0, left: 0, data: '' }
  if (!includeSchedule || card.state === 'new') return base
  const today = startOfDay(now)
  const dueDay = Math.round((startOfDay(card.due) - today) / DAY)
  const factor = Math.round(card.ease * 1000)
  // s/d: memória do FSRS; lrt: horário da última revisão (o Anki usa para calcular quanto já passou).
  const memory =
    card.stability !== null && card.difficulty !== null
      ? JSON.stringify({ s: +card.stability.toFixed(4), d: +card.difficulty.toFixed(4), ...(card.lastReviewAt ? { lrt: card.lastReviewAt } : {}) })
      : ''
  const common = { reps: card.reps, lapses: card.lapses, factor, data: memory }
  if (card.state === 'review') return { ...base, ...common, type: 2, queue: 2, due: dueDay, ivl: Math.max(1, Math.round(card.intervalDays)) }
  const type = card.state === 'learning' ? 1 : 3
  const ivl = card.state === 'relearning' ? Math.max(1, Math.round(card.intervalDays)) : 0
  // Passos curtos vencem por horário (fila 1); passos de dias, por dia (fila 3).
  return dueDay >= 1 ? { ...base, ...common, type, queue: 3, due: dueDay, ivl, left: 1001 } : { ...base, ...common, type, queue: 1, due: card.due, ivl, left: 1001 }
}

const REVLOG_TYPE: Record<string, number> = { new: 0, learning: 0, review: 1, relearning: 2 }

/** Intervalo do histórico no jeito do Anki: dias (positivo) ou segundos (negativo) quando menor que um dia. */
const revlogInterval = (days: number) => (days >= 1 ? Math.round(days) : -Math.max(1, Math.round(days * DAY)))

const NOTE_CSS = `.card { font-family: system-ui, sans-serif; font-size: 22px; text-align: center; color: black; background-color: white; }
.fonte { margin-top: 1.2em; font-size: 14px; color: #777; }
.nightMode .fonte { color: #aaa; }`

function collectionJson(decks: ExportData['decks'], now: number) {
  const nowMs = now * 1000
  const deckJson = (id: number, name: string) => ({
    id,
    name,
    mod: now,
    usn: -1,
    lrnToday: [0, 0],
    revToday: [0, 0],
    newToday: [0, 0],
    timeToday: [0, 0],
    collapsed: false,
    browserCollapsed: false,
    desc: '',
    dyn: 0,
    conf: 1,
    extendNew: 0,
    extendRev: 0
  })
  const allDecks: Record<string, unknown> = { 1: deckJson(1, 'Default') }
  for (const d of decks) allDecks[String(DECK_ID_BASE + d.id)] = deckJson(DECK_ID_BASE + d.id, d.title.replaceAll('::', ' › '))
  const field = (name: string, ord: number) => ({ name, ord, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] })
  const model = {
    id: MODEL_ID,
    name: 'Tramotak (Frente, Verso, Fonte)',
    type: 0,
    mod: now,
    usn: -1,
    sortf: 0,
    did: DECK_ID_BASE + (decks[0]?.id ?? 0),
    tmpls: [
      {
        name: 'Cartão 1',
        ord: 0,
        qfmt: '{{Frente}}',
        afmt: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Verso}}\n\n{{#Fonte}}<div class="fonte">{{Fonte}}</div>{{/Fonte}}',
        did: null,
        bqfmt: '',
        bafmt: ''
      }
    ],
    flds: [field('Frente', 0), field('Verso', 1), field('Fonte', 2)],
    css: NOTE_CSS,
    latexPre: '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
    latexPost: '\\end{document}',
    latexsvg: false,
    req: [[0, 'any', [0]]],
    tags: [],
    vers: []
  }
  const dconf = {
    1: {
      id: 1,
      name: 'Default',
      replayq: true,
      lapse: { delays: [10], mult: 0, minInt: 1, leechFails: 8, leechAction: 1 },
      rev: { perDay: 200, ease4: 1.3, fuzz: 0.05, minSpace: 1, ivlFct: 1, maxIvl: 36500, bury: false, hardFactor: 1.2 },
      timer: 0,
      maxTaken: 60,
      usn: 0,
      new: { perDay: 20, delays: [1, 10], separate: true, ints: [1, 4, 7], initialFactor: 2500, bury: false, order: 1 },
      mod: 0,
      autoplay: true,
      dyn: false
    }
  }
  const conf = {
    activeDecks: [1],
    curDeck: 1,
    newSpread: 0,
    collapseTime: 1200,
    timeLim: 0,
    estTimes: true,
    dueCounts: true,
    curModel: String(MODEL_ID),
    nextPos: 1,
    sortType: 'noteFld',
    sortBackwards: false,
    addToCur: true,
    schedVer: 2,
    creationOffset: new Date(nowMs).getTimezoneOffset()
  }
  return { conf, models: { [MODEL_ID]: model }, decks: allDecks, dconf }
}

const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null,
  dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null,
  dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null,
  tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null,
  usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null,
  factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null,
  odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null,
  lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);`

/** Monta o pacote .apkg (ZIP com a coleção e um arquivo de mídia vazio). */
export async function buildApkg(data: ExportData, options: { includeSchedule: boolean; installId: string; now?: number }): Promise<Buffer> {
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const dir = await mkdtemp(join(tmpdir(), 'tramotak-anki-'))
  const file = join(dir, 'collection.anki2')
  try {
    const col = new DatabaseSync(file)
    try {
      col.exec(SCHEMA)
      col.exec('PRAGMA user_version = 11')
      const json = collectionJson(data.decks, now)
      col
        .prepare('INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, ?)')
        .run(startOfDay(now), now * 1000, now * 1000, JSON.stringify(json.conf), JSON.stringify(json.models), JSON.stringify(json.decks), JSON.stringify(json.dconf), '{}')
      const insertNote = col.prepare('INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, ?)')
      const insertCard = col.prepare('INSERT INTO cards VALUES (?, ?, ?, 0, ?, -1, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)')
      const insertRev = col.prepare('INSERT INTO revlog VALUES (?, ?, -1, ?, ?, ?, ?, ?, ?)')
      const baseId = now * 1000
      const cardIds = new Map<number, number>()
      let position = 0
      col.exec('BEGIN')
      data.cards.forEach((card, i) => {
        const fields = [toAnkiHtml(card.front), toAnkiHtml(card.back), toAnkiHtml(card.source)]
        const noteId = baseId + i
        const ankiCardId = baseId + i
        cardIds.set(card.id, ankiCardId)
        insertNote.run(noteId, guidFor(options.installId, card.id), MODEL_ID, now, ' Tramotak ', fields.join('\x1f'), stripHtml(fields[0]), fieldChecksum(fields[0]), '')
        const s = ankiSchedule(card, card.state === 'new' || !options.includeSchedule ? ++position : 0, now, options.includeSchedule)
        insertCard.run(ankiCardId, noteId, DECK_ID_BASE + card.deckId, now, s.type, s.queue, s.due, s.ivl, s.factor, s.reps, s.lapses, s.left, s.data)
      })
      if (options.includeSchedule) {
        const used = new Set<number>()
        for (const r of data.reviews) {
          const cid = cardIds.get(r.cardId)
          if (cid === undefined) continue
          // O id do histórico é o horário em milissegundos e precisa ser único.
          let id = r.at * 1000
          while (used.has(id)) id++
          used.add(id)
          insertRev.run(
            id,
            cid,
            Math.min(4, Math.max(1, r.rating)),
            revlogInterval(r.intervalAfter),
            revlogInterval(r.intervalBefore),
            Math.round(r.ease * 1000),
            Math.min(60_000, Math.max(0, r.durationMs)),
            REVLOG_TYPE[r.stateBefore] ?? 1
          )
        }
      }
      col.exec('COMMIT')
    } finally {
      col.close()
    }
    return writeZip([
      { name: 'collection.anki2', data: await readFile(file) },
      { name: 'media', data: Buffer.from('{}') }
    ])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Texto para o Anki (Arquivo → Importar) e planilhas: uma carta por linha, com tabulação entre Frente, Verso, Fonte,
 * Baralho e Etiquetas, e os cabeçalhos que o Anki entende. Sem nomes de coluna de propósito: os campos do tipo "Básico"
 * mudam de nome com o idioma do Anki, e só pela posição a frente e o verso caem no lugar certo (a Fonte a pessoa liga a
 * um campo na janela de importação, se quiser). Tabulações dentro do texto viram espaço.
 */
export function buildText(data: ExportData): string {
  const titles = new Map(data.decks.map((d) => [d.id, d.title.replaceAll('::', ' › ')]))
  const cell = (text: string) => toAnkiHtml(text.replace(/\t/g, ' '))
  const lines = ['#separator:tab', '#html:true', '#deck column:4', '#tags column:5']
  for (const c of data.cards) lines.push([cell(c.front), cell(c.back), cell(c.source), cell(titles.get(c.deckId) ?? ''), 'Tramotak'].join('\t'))
  return `${lines.join('\n')}\n`
}

export const exportFileName = (data: ExportData, format: DeckExportRequest['format'], stamp: string) => {
  const base = data.decks.length === 1 ? data.decks[0].title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'baralho' : 'baralhos'
  return `Tramotak-${base}-${stamp}.${format === 'apkg' ? 'apkg' : 'txt'}`
}
