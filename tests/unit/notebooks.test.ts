import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateBlocks } from '@shared/notebooks'
import { addChild, createMap } from '@shared/mindmap'
import { openDatabase, type Database } from '../../src/main/db/database'
import { createNotebook, createPage, deleteNotebook, deletePage, getNotebook, getPage, listNotebooks, movePage, notebookPages, renameNotebook, savePage } from '../../src/main/db/notebooks'
import { createMindMap, deleteMindMap, getMindMap, listMindMaps, saveMindMap } from '../../src/main/db/mindmaps'
import { search } from '../../src/main/db/search'

let db: Database
beforeEach(() => {
  db = openDatabase(':memory:')
})
afterEach(() => db.close())

describe('blocos', () => {
  it('valida e descarta o que estiver malformado', () => {
    const blocks = validateBlocks([
      { id: 't', type: 'text', text: 'olá' },
      { id: 'i', type: 'ink', height: 5, strokes: [{ color: 'javascript:x', width: 999, points: [[1.234, 2, 2], ['x', 1], [3, 4]] }] },
      { id: 'r', type: 'resource', resource: { kind: 'lesson', id: 3, title: 'Aula' } },
      { id: 'r2', type: 'resource', resource: { kind: 'virus', id: 1 } },
      { type: 'text', text: 'sem id' },
      { id: 'x', type: 'desconhecido' }
    ])
    expect(blocks).toEqual([
      { id: 't', type: 'text', text: 'olá' },
      { id: 'i', type: 'ink', height: 120, strokes: [{ color: '#000000', width: 40, points: [[1.2, 2, 1], [3, 4, 0.5]] }] },
      { id: 'r', type: 'resource', resource: { kind: 'lesson', id: 3, title: 'Aula' } }
    ])
    expect(() => validateBlocks('nada')).toThrow('inválido')
  })
})

describe('cadernos', () => {
  it('nasce com uma página; páginas são criadas, reordenadas e excluídas', () => {
    const id = createNotebook(db, 'Cálculo')
    expect(getNotebook(db, id).pages.map((p) => p.title)).toEqual(['Página 1'])
    createPage(db, id)
    const third = createPage(db, id, 'Resumo')
    expect(getNotebook(db, id).pages.map((p) => p.title)).toEqual(['Página 1', 'Página 2', 'Resumo'])
    movePage(db, third.id, 0)
    expect(getNotebook(db, id).pages.map((p) => [p.title, p.position])).toEqual([['Resumo', 0], ['Página 1', 1], ['Página 2', 2]])
    deletePage(db, third.id)
    expect(getNotebook(db, id).pages.map((p) => [p.title, p.position])).toEqual([['Página 1', 0], ['Página 2', 1]])
    const only = createNotebook(db, 'Outro')
    expect(() => deletePage(db, getNotebook(db, only).pages[0].id)).toThrow('pelo menos uma')
  })

  it('salva blocos, entra na busca e exclusão em cascata limpa o índice', () => {
    const id = createNotebook(db, 'Física')
    const pageId = getNotebook(db, id).pages[0].id
    savePage(db, pageId, { title: 'Cinemática', blocks: [{ id: 'a', type: 'text', text: 'Velocidade média é distância sobre tempo' }, { id: 'b', type: 'resource', resource: { kind: 'course', id: 1, title: 'Física Básica' } }] }, 500)
    expect(getPage(db, pageId)).toMatchObject({ title: 'Cinemática', updatedAt: 500 })
    expect(notebookPages(db, id)[0].blocks).toHaveLength(2)
    expect(search(db, 'velocidade')).toEqual([expect.objectContaining({ kind: 'page', id: pageId, notebookId: id, notebookTitle: 'Física' })])
    expect(search(db, 'fisica basica').map((h) => h.kind)).toContain('page')
    renameNotebook(db, id, 'Física I')
    expect(listNotebooks(db)[0]).toMatchObject({ title: 'Física I', pageCount: 1 })
    deleteNotebook(db, id)
    expect(search(db, 'velocidade')).toEqual([])
  })
})

describe('mapas mentais', () => {
  it('cria com o título como tópico central, salva, busca e exclui', () => {
    const id = createMindMap(db, 'Biologia')
    const doc = getMindMap(db, id)
    expect(doc.data.nodes).toEqual([expect.objectContaining({ text: 'Biologia', parentId: null })])
    const data = addChild(doc.data, doc.data.rootId, 'Mitocôndria').map
    saveMindMap(db, id, { title: 'Biologia celular', data }, 900)
    expect(listMindMaps(db)[0]).toMatchObject({ title: 'Biologia celular', nodeCount: 2, updatedAt: 900 })
    expect(search(db, 'mitocondria')).toEqual([expect.objectContaining({ kind: 'mindmap', id })])
    expect(() => saveMindMap(db, id, { title: 'x', data: { version: 1, rootId: 'z', nodes: [] } })).toThrow()
    deleteMindMap(db, id)
    expect(search(db, 'mitocondria')).toEqual([])
  })

  it('importa dados de outro mapa', () => {
    const data = addChild(createMap('Raiz', 'r'), 'r', 'Filho').map
    const id = createMindMap(db, 'Importado', JSON.parse(JSON.stringify(data)))
    expect(getMindMap(db, id).nodeCount).toBe(2)
  })
})
