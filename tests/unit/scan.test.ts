import { afterEach, describe, expect, it } from 'vitest'
import type { ScannedModule, ScanResult } from '@shared/course'
import { scanCourse } from '../../src/main/scanner/scan'
import { makeCourse } from '../helpers/fixture'

let cleanup: (() => Promise<void>) | undefined
afterEach(async () => cleanup?.())

async function scan(files: string[], structure: 'auto' | 'flat' | 'modules' | 'submodules' = 'auto', numbering: 'dot' | 'dash' | 'none' = 'dot') {
  const course = await makeCourse(files)
  cleanup = course.cleanup
  return scanCourse(course.root, { structure, numbering })
}

/** Árvore resumida: títulos de módulos e aulas, para comparar com legibilidade. */
function outline(result: ScanResult) {
  const mod = (m: ScannedModule): unknown => ({
    [m.title]: [...m.lessons.map((l) => l.title), ...m.children.map(mod)]
  })
  return [...result.lessons.map((l) => l.title), ...result.modules.map(mod)]
}

describe('scanCourse', () => {
  it('flat: arquivos na raiz, em ordem natural', async () => {
    const r = await scan(['10. Final.mp4', '2. Meio.mp4', '1. Início.mp4'])
    expect(r.structure).toBe('flat')
    expect(outline(r)).toEqual(['Início', 'Meio', 'Final'])
    expect(r.stats).toMatchObject({ modules: 0, lessons: 3, videos: 3 })
  })

  it('auto detecta módulos > aulas', async () => {
    const r = await scan([
      '02. Derivadas/01. Regra da cadeia.mp4',
      '01. Limites/02. Laterais.mp4',
      '01. Limites/01. Introdução.mp4'
    ])
    expect(r.structure).toBe('modules')
    expect(outline(r)).toEqual([
      { Limites: ['Introdução', 'Laterais'] },
      { Derivadas: ['Regra da cadeia'] }
    ])
  })

  it('auto detecta módulos > submódulos > aulas', async () => {
    const r = await scan([
      '1. Cálculo/1. Limites/1. Intro.mp4',
      '1. Cálculo/1. Limites/2. Laterais.mp4',
      '1. Cálculo/2. Derivadas/1. Regras.mp4',
      '1. Cálculo/2. Derivadas/2. Cadeia.mp4',
      '2. Álgebra/1. Vetores.mp4'
    ])
    expect(r.structure).toBe('submodules')
    expect(outline(r)).toEqual([
      { Cálculo: [{ Limites: ['Intro', 'Laterais'] }, { Derivadas: ['Regras', 'Cadeia'] }] },
      { Álgebra: ['Vetores'] }
    ])
  })

  it('submódulos de uma aula só parecem pastas-aula no auto; a estrutura explícita resolve', async () => {
    const files = ['1. Cálculo/1. Limites/1. Aula.mp4', '1. Cálculo/2. Derivadas/1. Aula.mp4']
    expect(outline(await scan(files))).toEqual([{ Cálculo: ['Limites', 'Derivadas'] }])
    expect(outline(await scan(files, 'submodules'))).toEqual([
      { Cálculo: [{ Limites: ['Aula'] }, { Derivadas: ['Aula'] }] }
    ])
  })

  it('auto colapsa pastas-aula (uma pasta por aula com vídeo + material)', async () => {
    const r = await scan([
      '1. Módulo/1. Boas-vindas/video.mp4',
      '1. Módulo/1. Boas-vindas/slides.pdf',
      '1. Módulo/1. Boas-vindas/video.pt.srt',
      '1. Módulo/2. Conceitos/aula.mp4'
    ])
    expect(r.structure).toBe('modules')
    expect(outline(r)).toEqual([{ Módulo: ['Boas-vindas', 'Conceitos'] }])
    const lesson = r.modules[0].lessons[0]
    expect(lesson.relPath).toBe('1. Módulo/1. Boas-vindas/video.mp4')
    expect(lesson.assets).toEqual([
      { kind: 'attachment', relPath: '1. Módulo/1. Boas-vindas/slides.pdf', lang: null },
      { kind: 'subtitle', relPath: '1. Módulo/1. Boas-vindas/video.pt.srt', lang: 'pt' }
    ])
  })

  it('aulas soltas na raiz ficam fora dos módulos', async () => {
    const r = await scan(['0. Leia-me.md', '1. Módulo/1. Aula.mp4'])
    expect(outline(r)).toEqual(['Leia-me', { Módulo: ['Aula'] }])
    expect(r.lessons[0].kind).toBe('text')
  })

  it('estrutura explícita mais rasa achata as subpastas e avisa', async () => {
    const r = await scan(['1. Mod/1. Sub/1. Aula.mp4', '1. Mod/2. Sub/1. Outra.mp4'], 'modules')
    expect(outline(r)).toEqual([{ Mod: ['Aula', 'Outra'] }])
    expect(r.warnings.filter((w) => w.code === 'flattened')).toHaveLength(2)
  })

  it('flat explícito junta tudo na raiz', async () => {
    const r = await scan(['1. A/1. x.mp4', '2. B/1. y.mp4'], 'flat')
    expect(r.structure).toBe('flat')
    expect(outline(r)).toEqual(['x', 'y'])
  })

  it('casa legendas e anexos pelo nome-base do vídeo', async () => {
    const r = await scan(['01. Aula.mp4', '01. Aula.srt', '01. Aula.en.vtt', '01. Aula.pdf', 'Material extra.pdf', 'sem-video.srt'])
    expect(outline(r)).toEqual(['Aula', 'Material extra'])
    const [aula, material] = r.lessons
    expect(aula.assets.map((a) => [a.kind, a.lang])).toEqual([
      ['subtitle', 'en'],
      ['attachment', null],
      ['subtitle', null]
    ])
    expect(material.kind).toBe('document')
    expect(r.stats).toMatchObject({ lessons: 2, subtitles: 2, attachments: 1 })
  })

  it('ignora arquivos ocultos, lixo do sistema e pastas ocultas', async () => {
    const r = await scan(['1. Aula.mp4', '.DS_Store', 'Thumbs.db', 'desktop.ini', '.git/config', 'setup.exe'])
    expect(outline(r)).toEqual(['Aula'])
  })

  it('numeração com traço', async () => {
    const r = await scan(['01 - Módulo/01 - Aula.mp4'], 'auto', 'dash')
    expect(outline(r)).toEqual([{ Módulo: ['Aula'] }])
  })

  it('avisa pasta vazia e formatos arriscados', async () => {
    const empty = await scan(['notas.exe'])
    expect(empty.warnings[0].code).toBe('empty')

    const risky = await scan(['1. Aula.mkv', '2. Aula.mp4'])
    expect(risky.warnings).toEqual([expect.objectContaining({ code: 'maybe-unsupported', relPath: '1. Aula.mkv' })])
  })

  it('guarda tamanho e mtime para a revalidação', async () => {
    const r = await scan(['1. Aula.mp4'])
    expect(r.lessons[0].size).toBe(1)
    expect(r.lessons[0].mtimeMs).toBeGreaterThan(0)
  })
})
