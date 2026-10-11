import { describe, expect, it } from 'vitest'
import { naturalCompare } from '../../src/main/scanner/naturalSort'
import { cleanTitle } from '../../src/main/scanner/titles'
import { matchSubtitle, srtToVtt } from '../../src/main/scanner/subtitles'
import { classify } from '../../src/main/scanner/files'

describe('naturalCompare', () => {
  it('ordena números como números, sem diferenciar caixa e acento', () => {
    const names = ['10 Aula', '2 Aula', '1 Aula', 'b', 'Á', 'a']
    expect(names.sort(naturalCompare)).toEqual(['1 Aula', '2 Aula', '10 Aula', 'Á', 'a', 'b'])
  })
})

describe('cleanTitle', () => {
  it.each([
    ['01. Introdução.mp4', 'dot', 'Introdução'],
    ['1) Introdução.mp4', 'dot', 'Introdução'],
    ['2.3. Subtópico.mp4', 'dot', 'Subtópico'],
    ['01 - Introdução.mp4', 'dash', 'Introdução'],
    ['01_Introdução.mp4', 'dash', 'Introdução'],
    ['01 - Introdução.mp4', 'none', '01 - Introdução'],
    ['01.mp4', 'dot', '01'],
    ['01. Módulo', 'dot', 'Módulo']
  ] as const)('%s (%s) → %s', (name, numbering, expected) => {
    expect(cleanTitle(name, numbering, name.includes('.mp4'))).toBe(expected)
  })

  it('não confunde o ponto da extensão com numeração em pastas', () => {
    expect(cleanTitle('Módulo 1.5', 'dot', false)).toBe('Módulo 1.5')
  })
})

describe('matchSubtitle', () => {
  it.each([
    ['aula.srt', null],
    ['aula.pt.srt', 'pt'],
    ['aula.pt-BR.vtt', 'pt-BR'],
    ['aula.en_US.srt', 'en-US'],
    ['aula 2.srt', undefined],
    ['aula.comentarios.srt', undefined]
  ])('aula + %s → %s', (sub, expected) => {
    expect(matchSubtitle('aula', sub)).toBe(expected)
  })
})

describe('srtToVtt', () => {
  it('troca vírgula por ponto nos tempos e adiciona o cabeçalho', () => {
    const srt = '\uFEFF1\r\n00:00:01,500 --> 00:00:03,000\r\nOlá\r\n'
    expect(srtToVtt(srt)).toBe('WEBVTT\n\n1\n00:00:01.500 --> 00:00:03.000\nOlá\n')
  })
})

describe('classify', () => {
  it.each([
    ['aula.MP4', 'video'],
    ['aula.srt', 'subtitle'],
    ['notas.md', 'text'],
    ['slides.pdf', 'document'],
    ['.DS_Store', 'ignored'],
    ['Thumbs.db', 'ignored'],
    ['~$rascunho.docx', 'ignored'],
    ['programa.exe', 'ignored']
  ])('%s → %s', (name, expected) => {
    expect(classify(name)).toBe(expected)
  })
})
