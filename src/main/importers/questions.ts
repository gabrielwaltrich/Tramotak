import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { validateQuestion, type QuestionInput, type QuestionOption, type QuestionType } from '@shared/questions'
import { transaction, type Database } from '../db/database'
import { createBank, createQuestion, getBank, listQuestions } from '../db/questions'

export interface ParsedQuestions {
  title: string | null
  description: string
  questions: QuestionInput[]
  /** Questões que não puderam ser lidas (formato não suportado ou inválidas). */
  skipped: number
}

export interface QuestionImportResult {
  bankId: number
  bankTitle: string
  imported: number
  skipped: number
}

const MAX_FILE_BYTES = 50 * 1024 * 1024
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'
const optionId = (i: number) => `o${i + 1}`
const options = (texts: string[]): QuestionOption[] => texts.map((text, i) => ({ id: optionId(i), text: text.trim() })).filter((o) => o.text)

/** Valida cada questão; as inválidas são contadas como puladas em vez de abortar tudo. */
function keepValid(raw: QuestionInput[], skipped = 0): { questions: QuestionInput[]; skipped: number } {
  const questions: QuestionInput[] = []
  for (const q of raw) {
    try {
      questions.push(validateQuestion(q))
    } catch {
      skipped++
    }
  }
  return { questions, skipped }
}

// ── JSON (formato próprio) ──────────────────────────────────────────────────

const JSON_FORMAT = 'tramotak-questions'

export function exportJson(db: Database, bankId: number): string {
  const bank = getBank(db, bankId)
  const questions = listQuestions(db, bankId).map(({ type, statement, options: opts, key, explanation, topic, difficulty, points }) => ({
    type, statement, options: opts, key, explanation, topic, difficulty, points
  }))
  return JSON.stringify({ format: JSON_FORMAT, version: 1, bank: { title: bank.title, description: bank.description }, questions }, null, 2)
}

export function parseJson(content: string): ParsedQuestions {
  let data: unknown
  try {
    data = JSON.parse(content)
  } catch {
    throw new Error('JSON inválido')
  }
  const obj = data as { format?: string; bank?: { title?: string; description?: string }; questions?: QuestionInput[] }
  const list = Array.isArray(data) ? (data as QuestionInput[]) : obj.questions
  if (!Array.isArray(list)) throw new Error('O JSON não tem uma lista de questões')
  const { questions, skipped } = keepValid(list)
  return { title: obj.bank?.title?.trim() || null, description: obj.bank?.description ?? '', questions, skipped }
}

// ── CSV ─────────────────────────────────────────────────────────────────────

/** Lê CSV com aspas ("a;b" e "" para aspas literais) e quebras de linha dentro de campos. */
export function parseCsvRows(content: string): string[][] {
  const text = content.replace(/^\uFEFF/, '')
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const sep = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === sep) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      if (row.some((f) => f.trim())) rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  row.push(field)
  if (row.some((f) => f.trim())) rows.push(row)
  return rows
}

const TYPE_ALIASES: Record<string, QuestionType> = {
  single: 'single', multipla: 'single', 'multipla escolha': 'single', unica: 'single',
  multiple: 'multiple', 'multipla resposta': 'multiple', multiplas: 'multiple',
  truefalse: 'truefalse', vf: 'truefalse', 'verdadeiro ou falso': 'truefalse', 'verdadeiro/falso': 'truefalse',
  short: 'short', curta: 'short', 'resposta curta': 'short',
  essay: 'essay', dissertativa: 'essay', aberta: 'essay'
}

function plain(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}

/** "A", "1" ou o texto da alternativa → índice. */
function optionIndex(token: string, texts: string[]): number {
  const t = token.trim()
  if (/^[a-z]$/i.test(t)) return LETTERS.indexOf(t.toLowerCase())
  if (/^\d+$/.test(t)) return Number(t) - 1
  return texts.findIndex((x) => plain(x) === plain(t))
}

const CSV_HEADER = ['tipo', 'enunciado', 'alternativas', 'correta', 'explicacao', 'topico', 'dificuldade', 'pontos']

/**
 * Colunas: tipo; enunciado; alternativas (separadas por |); correta; explicação; tópico; dificuldade; pontos.
 * "correta": letra/número/texto (múltipla escolha), várias separadas por | (múltipla resposta),
 * V/F (verdadeiro ou falso), respostas aceitas separadas por | (curta) ou resposta de referência (dissertativa).
 */
export function parseCsv(content: string): ParsedQuestions {
  const rows = parseCsvRows(content)
  if (rows.length === 0) throw new Error('CSV vazio')
  const header = rows[0].map(plain)
  const hasHeader = header.includes('enunciado') || header.includes('statement')
  const col = (name: string, fallback: number) => {
    const i = header.indexOf(name)
    return hasHeader && i >= 0 ? i : fallback
  }
  const c = {
    type: col('tipo', 0), statement: col('enunciado', 1), options: col('alternativas', 2), correct: col('correta', 3),
    explanation: col('explicacao', 4), topic: col('topico', 5), difficulty: col('dificuldade', 6), points: col('pontos', 7)
  }

  const raw: QuestionInput[] = []
  let skipped = 0
  for (const r of hasHeader ? rows.slice(1) : rows) {
    const get = (i: number) => (r[i] ?? '').trim()
    const type = TYPE_ALIASES[plain(get(c.type))]
    if (!type) {
      skipped++
      continue
    }
    const texts = get(c.options) ? get(c.options).split('|').map((s) => s.trim()) : []
    const correct = get(c.correct)
    const base = { statement: get(c.statement), explanation: get(c.explanation), topic: get(c.topic), difficulty: Number(get(c.difficulty)) || 3, points: Number(get(c.points).replace(',', '.')) || 1 }
    if (type === 'single') {
      raw.push({ ...base, type, options: options(texts), key: { type, correct: optionId(optionIndex(correct, texts)) } })
    } else if (type === 'multiple') {
      const ids = correct.split(/[|,]/).map((t) => optionId(optionIndex(t, texts)))
      raw.push({ ...base, type, options: options(texts), key: { type, correct: ids } })
    } else if (type === 'truefalse') {
      const v = plain(correct)
      const value = ['v', 'verdadeiro', 'true', 't', '1', 'sim'].includes(v) ? true : ['f', 'falso', 'false', '0', 'nao'].includes(v) ? false : null
      raw.push({ ...base, type, options: [], key: { type, correct: value as boolean } })
    } else if (type === 'short') {
      raw.push({ ...base, type, options: [], key: { type, accepted: correct.split('|') } })
    } else {
      raw.push({ ...base, type, options: [], key: { type, reference: correct } })
    }
  }
  return { title: null, description: '', ...keepValid(raw, skipped) }
}

function csvField(value: string | number): string {
  const s = String(value)
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function exportCsv(db: Database, bankId: number): string {
  const lines = [CSV_HEADER.join(';')]
  for (const q of listQuestions(db, bankId)) {
    const letter = (id: string) => LETTERS[q.options.findIndex((o) => o.id === id)]?.toUpperCase() ?? ''
    const correct =
      q.key.type === 'single' ? letter(q.key.correct)
      : q.key.type === 'multiple' ? q.key.correct.map(letter).join('|')
      : q.key.type === 'truefalse' ? (q.key.correct ? 'V' : 'F')
      : q.key.type === 'short' ? q.key.accepted.join('|')
      : q.key.reference
    lines.push([q.type, q.statement, q.options.map((o) => o.text).join('|'), correct, q.explanation, q.topic, q.difficulty, q.points].map(csvField).join(';'))
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

// ── GIFT (Moodle) ───────────────────────────────────────────────────────────

/**
 * Desfaz os escapes do GIFT. "\\n" vira quebra de linha só fora das fórmulas: dentro de $...$
 * é comando LaTeX (\\neq, \\nabla).
 */
function unescapeGift(s: string): string {
  return s
    .split(/(\$\$[\s\S]+?\$\$|(?<!\\)\$(?:\\\$|[^$\n])+?\$)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/\\n/g, '\n')))
    .join('')
    .replace(/\\([:=~#{}\\])/g, '$1')
    .trim()
}

/** Bloco de respostas: o último grupo de chaves, casado por profundidade (o LaTeX do enunciado também usa chaves). */
function answerBlock(block: string): { open: number; close: number } | null {
  const escaped = (i: number) => {
    let n = 0
    for (let j = i - 1; j >= 0 && block[j] === '\\'; j--) n++
    return n % 2 === 1
  }
  let close = -1
  for (let i = block.length - 1; i >= 0; i--) {
    if (block[i] === '}' && !escaped(i)) {
      close = i
      break
    }
  }
  if (close < 0) return null
  let depth = 0
  for (let i = close; i >= 0; i--) {
    if (escaped(i)) continue
    if (block[i] === '}') depth++
    else if (block[i] === '{' && --depth === 0) return { open: i, close }
  }
  return null
}

/** Divide no caractere `char` quando não está escapado com "\". */
function splitUnescaped(text: string, chars: string): { sep: string; part: string }[] {
  const parts: { sep: string; part: string }[] = []
  let current = ''
  let sep = ''
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') {
      current += text[i] + (text[i + 1] ?? '')
      i++
    } else if (chars.includes(text[i])) {
      parts.push({ sep, part: current })
      sep = text[i]
      current = ''
    } else current += text[i]
  }
  parts.push({ sep, part: current })
  return parts
}

/**
 * Subconjunto do GIFT: múltipla escolha ({=certa ~errada}), múltipla resposta (~%50%a ~%50%b),
 * verdadeiro/falso ({T}/{F}), resposta curta ({=a =b}), dissertativa ({}), $CATEGORY e feedback geral (####).
 * Associação e numérica são puladas.
 */
export function parseGift(content: string): ParsedQuestions {
  const blocks = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')
    .split(/\n\s*\n/)
  const raw: QuestionInput[] = []
  let skipped = 0
  let topic = ''

  for (let block of blocks) {
    block = block.trim()
    if (!block) continue
    const category = /^\$CATEGORY:\s*(.+)$/m.exec(block)
    if (category) {
      topic = category[1].trim().split('/').filter(Boolean).pop()?.replace(/^\$\w+\$/, '') ?? ''
      block = block.replace(category[0], '').trim()
      if (!block) continue
    }
    block = block.replace(/^::(.*?)::/s, '').replace(/^\[(html|markdown|plain|moodle)\]/i, '')
    const braces = answerBlock(block)
    if (!braces) {
      skipped++
      continue
    }
    const { open, close } = braces
    const statement = unescapeGift(`${block.slice(0, open)} ${block.slice(close + 1)}`.replace(/\s+/g, ' '))
    let body = block.slice(open + 1, close).trim()
    let explanation = ''
    const general = body.indexOf('####')
    if (general >= 0) {
      explanation = unescapeGift(body.slice(general + 4))
      body = body.slice(0, general).trim()
    }
    const base = { statement, explanation, topic, difficulty: 3, points: 1 }

    if (body === '') {
      raw.push({ ...base, type: 'essay', options: [], key: { type: 'essay', reference: '' } })
      continue
    }
    if (/^(T|TRUE|F|FALSE)(\s*#.*)?$/is.test(body)) {
      raw.push({ ...base, type: 'truefalse', options: [], key: { type: 'truefalse', correct: /^T/i.test(body) } })
      continue
    }
    if (body.startsWith('#') || body.includes('->')) {
      skipped++ // numérica ou associação
      continue
    }

    const answers = splitUnescaped(body, '=~')
      .filter((p) => p.sep)
      .map(({ sep, part }) => {
        const [textWithWeight] = splitUnescaped(part, '#').map((x) => x.part)
        const weight = /^%(-?\d+(?:\.\d+)?)%/.exec(textWithWeight.trim())
        const text = unescapeGift(textWithWeight.trim().replace(/^%-?\d+(?:\.\d+)?%/, ''))
        return { right: sep === '=' || (weight !== null && Number(weight[1]) > 0), sep, text }
      })
    if (answers.length === 0) {
      skipped++
      continue
    }
    const hasWrong = answers.some((a) => a.sep === '~')
    if (!hasWrong) {
      raw.push({ ...base, type: 'short', options: [], key: { type: 'short', accepted: answers.map((a) => a.text) } })
      continue
    }
    const opts = options(answers.map((a) => a.text))
    const correct = answers.map((a, i) => (a.right ? optionId(i) : null)).filter((id): id is string => id !== null)
    if (correct.length > 1 || answers.some((a) => a.sep === '~' && a.right)) {
      raw.push({ ...base, type: 'multiple', options: opts, key: { type: 'multiple', correct } })
    } else {
      raw.push({ ...base, type: 'single', options: opts, key: { type: 'single', correct: correct[0] ?? '' } })
    }
  }
  return { title: null, description: '', ...keepValid(raw, skipped) }
}

const escapeGift = (s: string) => s.replace(/([:=~#{}\\])/g, '\\$1').replace(/\n/g, '\\n')

export function exportGift(db: Database, bankId: number): string {
  const out: string[] = []
  let topic: string | null = null
  for (const q of listQuestions(db, bankId).sort((a, b) => a.topic.localeCompare(b.topic) || a.id - b.id)) {
    if (q.topic !== topic) {
      topic = q.topic
      if (topic) out.push(`$CATEGORY: ${topic}`)
    }
    const feedback = q.explanation ? ` ####${escapeGift(q.explanation)}` : ''
    let body: string
    if (q.key.type === 'truefalse') body = q.key.correct ? 'TRUE' : 'FALSE'
    else if (q.key.type === 'short') body = q.key.accepted.map((a) => `=${escapeGift(a)}`).join(' ')
    else if (q.key.type === 'essay') body = ''
    else if (q.key.type === 'single') {
      const key = q.key
      body = q.options.map((o) => `${o.id === key.correct ? '=' : '~'}${escapeGift(o.text)}`).join(' ')
    } else {
      const correct = q.key.correct
      const share = Math.floor(100 / correct.length * 100000) / 100000
      body = q.options.map((o) => `~%${correct.includes(o.id) ? share : -100}%${escapeGift(o.text)}`).join(' ')
    }
    out.push(`${escapeGift(q.statement)} {${body}${feedback}}`)
  }
  return `${out.join('\n\n')}\n`
}

// ── Importar arquivo ────────────────────────────────────────────────────────

export async function parseQuestionFile(path: string): Promise<ParsedQuestions> {
  const buf = await readFile(path)
  if (buf.length > MAX_FILE_BYTES) throw new Error('Arquivo grande demais para importar')
  const content = buf.toString('utf8')
  const ext = extname(path).toLowerCase()
  if (ext === '.json') return parseJson(content)
  if (ext === '.csv' || ext === '.tsv') return parseCsv(content)
  if (ext === '.gift' || ext === '.txt') return parseGift(content)
  throw new Error('Formato não suportado. Use .json, .csv ou .gift (Moodle)')
}

/** Importa para um banco existente ou cria um novo (com o nome do arquivo ou do JSON). */
export async function importQuestionFile(db: Database, path: string, bankId: number | null): Promise<QuestionImportResult> {
  const parsed = await parseQuestionFile(path)
  if (parsed.questions.length === 0) throw new Error(parsed.skipped ? `Nenhuma questão válida (${parsed.skipped} puladas)` : 'Nenhuma questão encontrada')
  return transaction(db, () => {
    const id = bankId ?? createBank(db, { title: parsed.title ?? (basename(path, extname(path)) || 'Banco importado'), description: parsed.description })
    for (const q of parsed.questions) createQuestion(db, id, q)
    return { bankId: id, bankTitle: getBank(db, id).title, imported: parsed.questions.length, skipped: parsed.skipped }
  })
}
