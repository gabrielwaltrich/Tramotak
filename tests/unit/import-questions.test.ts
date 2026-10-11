import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { QuestionInput } from '@shared/questions'
import { openDatabase, type Database } from '../../src/main/db/database'
import { createBank, createQuestion, listBanks, listQuestions } from '../../src/main/db/questions'
import {
  exportCsv,
  exportGift,
  exportJson,
  importQuestionFile,
  parseCsv,
  parseCsvRows,
  parseGift,
  parseJson
} from '../../src/main/importers/questions'

let db: Database
let dir: string

beforeEach(async () => {
  db = openDatabase(':memory:')
  dir = await mkdtemp(join(tmpdir(), 'tramotak-q-'))
})
afterEach(async () => {
  db.close()
  await rm(dir, { recursive: true, force: true })
})

const summary = (qs: QuestionInput[]) => qs.map((q) => ({ type: q.type, statement: q.statement, key: q.key, options: q.options.map((o) => o.text) }))

describe('CSV', () => {
  it('lê aspas, separador e quebra de linha dentro de campo', () => {
    expect(parseCsvRows('a;"b;c";"d ""e"""\n"linha\nquebrada";x\n')).toEqual([
      ['a', 'b;c', 'd "e"'],
      ['linha\nquebrada', 'x']
    ])
    expect(parseCsvRows('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('todos os tipos, com nomes em português e gabarito por letra, texto ou V/F', () => {
    const csv = [
      'tipo;enunciado;alternativas;correta;explicação;tópico;dificuldade;pontos',
      'Múltipla escolha;Derivada de x²?;2x|x|2;A;regra do tombo;Derivadas;2;1,5',
      'multipla resposta;Pares?;1|2|3|4;B|D;;Números;;',
      'VF;O céu é verde;;F;;;;',
      'curta;Capital do Brasil;;Brasília|DF;;;;',
      'dissertativa;Explique limites;;aproximação;;;;',
      'multipla;Sem gabarito válido;a|b;Z;;;;',
      'desconhecido;x;;;;;;'
    ].join('\n')
    const parsed = parseCsv(csv)
    expect(parsed.skipped).toBe(2)
    expect(summary(parsed.questions)).toEqual([
      { type: 'single', statement: 'Derivada de x²?', key: { type: 'single', correct: 'o1' }, options: ['2x', 'x', '2'] },
      { type: 'multiple', statement: 'Pares?', key: { type: 'multiple', correct: ['o2', 'o4'] }, options: ['1', '2', '3', '4'] },
      { type: 'truefalse', statement: 'O céu é verde', key: { type: 'truefalse', correct: false }, options: [] },
      { type: 'short', statement: 'Capital do Brasil', key: { type: 'short', accepted: ['Brasília', 'DF'] }, options: [] },
      { type: 'essay', statement: 'Explique limites', key: { type: 'essay', reference: 'aproximação' }, options: [] }
    ])
    expect(parsed.questions[0]).toMatchObject({ explanation: 'regra do tombo', topic: 'Derivadas', difficulty: 2, points: 1.5 })
  })
})

describe('GIFT', () => {
  it('lê os tipos suportados, categoria, título, feedback e escapes', () => {
    const gift = `
// comentário ignorado
$CATEGORY: $course$/Matemática/Cálculo

::Q1:: Derivada de x\\{2\\}? {=2x ~x ~2 ####Regra do tombo}

Números primos {~%50%2 ~%50%3 ~%-100%4}

A Terra é plana {F}

Capital do Brasil {=Brasília =DF}

Explique o que é um limite {}

Associação {=a -> 1 =b -> 2}

Numérica {#3.14:0.01}
`
    const parsed = parseGift(gift)
    expect(parsed.skipped).toBe(2)
    expect(summary(parsed.questions)).toEqual([
      { type: 'single', statement: 'Derivada de x{2}?', key: { type: 'single', correct: 'o1' }, options: ['2x', 'x', '2'] },
      { type: 'multiple', statement: 'Números primos', key: { type: 'multiple', correct: ['o1', 'o2'] }, options: ['2', '3', '4'] },
      { type: 'truefalse', statement: 'A Terra é plana', key: { type: 'truefalse', correct: false }, options: [] },
      { type: 'short', statement: 'Capital do Brasil', key: { type: 'short', accepted: ['Brasília', 'DF'] }, options: [] },
      { type: 'essay', statement: 'Explique o que é um limite', key: { type: 'essay', reference: '' }, options: [] }
    ])
    expect(parsed.questions[0]).toMatchObject({ topic: 'Cálculo', explanation: 'Regra do tombo' })
  })
})

describe('GIFT com LaTeX', () => {
  it('chaves do LaTeX no enunciado e na explicação não confundem o bloco de respostas', () => {
    const gift = [
      '$\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$ {T ####Limite {fundamental}}',
      '',
      'Derivada de $x^n$? {=$n x^{n-1}$ ~$x^{n+1}$ ####Use $\\frac{d}{dx}$}',
      '',
      'Se $a \\neq b$ então\\nescolha: {=certo ~errado}'
    ].join('\n')
    const parsed = parseGift(gift)
    expect(parsed.skipped).toBe(0)
    expect(parsed.questions.map((q) => [q.type, q.statement])).toEqual([
      ['truefalse', '$\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$'],
      ['single', 'Derivada de $x^n$?'],
      ['single', 'Se $a \\neq b$ então\nescolha:']
    ])
    expect(parsed.questions[0]).toMatchObject({ key: { type: 'truefalse', correct: true }, explanation: 'Limite {fundamental}' })
    expect(parsed.questions[1].options.map((o) => o.text)).toEqual(['$n x^{n-1}$', '$x^{n+1}$'])
    expect(parsed.questions[1].explanation).toBe('Use $\\frac{d}{dx}$')
  })
})

describe('ida e volta', () => {
  function seed(): number {
    const bankId = createBank(db, { title: 'Original', description: 'desc' })
    const base = { explanation: 'por quê', topic: 'Tópico; com ponto e vírgula', difficulty: 4, points: 2 }
    createQuestion(db, bankId, { ...base, type: 'single', statement: 'Qual {é} = a "certa"?', options: [{ id: 'x', text: 'esta' }, { id: 'y', text: 'outra' }], key: { type: 'single', correct: 'x' } })
    createQuestion(db, bankId, { ...base, type: 'multiple', statement: 'Duas certas', options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }, { id: 'c', text: 'c' }], key: { type: 'multiple', correct: ['a', 'c'] } })
    createQuestion(db, bankId, { ...base, type: 'truefalse', statement: 'Verdade', options: [], key: { type: 'truefalse', correct: true } })
    createQuestion(db, bankId, { ...base, type: 'short', statement: 'Curta', options: [], key: { type: 'short', accepted: ['um', 'dois'] } })
    createQuestion(db, bankId, { ...base, type: 'essay', statement: 'Aberta\ncom duas linhas', options: [], key: { type: 'essay', reference: 'ref' } })
    return bankId
  }
  it('JSON preserva tudo, inclusive título e descrição do banco', () => {
    const bankId = seed()
    const parsed = parseJson(exportJson(db, bankId))
    expect(parsed).toMatchObject({ title: 'Original', description: 'desc', skipped: 0 })
    expect(parsed.questions).toEqual(listQuestions(db, bankId).map(({ type, statement, options, key, explanation, topic, difficulty, points }) => ({ type, statement, options, key, explanation, topic, difficulty, points })))
  })

  it('CSV preserva tipos, textos, gabarito e metadados', () => {
    const bankId = seed()
    const parsed = parseCsv(exportCsv(db, bankId))
    expect(parsed.skipped).toBe(0)
    expect(summary(parsed.questions).map((q) => [q.type, q.statement, q.options])).toEqual(summary(listQuestions(db, bankId)).map((q) => [q.type, q.statement, q.options]))
    expect(parsed.questions.map((q) => q.key.type === 'multiple' ? q.key.correct : null)[1]).toEqual(['o1', 'o3'])
    expect(parsed.questions[0]).toMatchObject({ topic: 'Tópico; com ponto e vírgula', difficulty: 4, points: 2, explanation: 'por quê' })
  })

  it('GIFT preserva tipos, gabarito, explicação e tópico', () => {
    const bankId = seed()
    const parsed = parseGift(exportGift(db, bankId))
    expect(parsed.skipped).toBe(0)
    expect(parsed.questions.map((q) => [q.type, q.statement, q.explanation, q.topic])).toEqual(
      listQuestions(db, bankId).map((q) => [q.type, q.statement, q.explanation, 'Tópico; com ponto e vírgula'])
    )
    expect(parsed.questions[1].key).toEqual({ type: 'multiple', correct: ['o1', 'o3'] })
  })
})

describe('importQuestionFile', () => {
  it('cria banco novo com o nome do arquivo ou importa para um existente', async () => {
    const path = join(dir, 'Biologia.gift')
    await writeFile(path, 'Mitocôndria produz energia {T}\n\nCélula vegetal tem {=parede celular}\n')
    const created = await importQuestionFile(db, path, null)
    expect(created).toMatchObject({ bankTitle: 'Biologia', imported: 2, skipped: 0 })

    const existing = createBank(db, { title: 'Meu banco' })
    const again = await importQuestionFile(db, path, existing)
    expect(again).toMatchObject({ bankId: existing, bankTitle: 'Meu banco', imported: 2 })
    expect(listBanks(db).map((b) => [b.title, b.questionCount])).toEqual(expect.arrayContaining([['Biologia', 2], ['Meu banco', 2]]))
  })

  it('erros claros', async () => {
    const bad = join(dir, 'x.json')
    await writeFile(bad, '{ não é json')
    await expect(importQuestionFile(db, bad, null)).rejects.toThrow('JSON inválido')
    const none = join(dir, 'vazio.gift')
    await writeFile(none, 'Associação {=a -> 1}')
    await expect(importQuestionFile(db, none, null)).rejects.toThrow('Nenhuma questão válida (1 puladas)')
    const docx = join(dir, 'x.docx')
    await writeFile(docx, 'x')
    await expect(importQuestionFile(db, docx, null)).rejects.toThrow('não suportado')
  })
})
