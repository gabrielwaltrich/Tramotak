import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Database } from '../../src/main/db/database'
import { insertScannedCourse, listCourseSummaries } from '../../src/main/db/courses'
import {
  assetFilePath,
  getLessonView,
  lessonFilePath,
  resolveInside,
  saveProgress,
  setCompleted,
  setDuration,
  setFavorite
} from '../../src/main/db/lessons'
import { scanCourse } from '../../src/main/scanner/scan'
import { parseMediaUrl, mediaUrl } from '@shared/media'
import { makeCourse } from '../helpers/fixture'

let db: Database
let root: string
let cleanup: (() => Promise<void>) | undefined

beforeEach(async () => {
  db = openDatabase(':memory:')
  const course = await makeCourse([
    '0. Intro.md',
    '1. Mod/1. Primeira.mp4',
    '1. Mod/1. Primeira.pt.srt',
    '1. Mod/1. Primeira.pdf',
    '1. Mod/2. Segunda.mp4',
    '2. Outro/1. Terceira.mp4'
  ])
  root = course.root
  cleanup = course.cleanup
  const scan = await scanCourse(root, { structure: 'auto', numbering: 'dot' })
  insertScannedCourse(db, { title: 'Curso', rootPath: root, numbering: 'dot', scanStructure: 'auto' }, scan)
})
afterEach(async () => {
  db.close()
  await cleanup?.()
})

const id = (title: string) => (db.prepare('SELECT id FROM lessons WHERE title = ?').get(title) as { id: number }).id
const sessions = () => db.prepare('SELECT started_at AS s, ended_at AS e, seconds FROM study_sessions ORDER BY id').all()

describe('getLessonView', () => {
  it('traz anexos, legenda com URL do protocolo e vizinhos na ordem de estudo', () => {
    const view = getLessonView(db, id('Primeira'))
    expect(view).toMatchObject({
      title: 'Primeira',
      kind: 'video',
      url: mediaUrl.lesson(id('Primeira')),
      moduleTitle: 'Mod',
      course: { title: 'Curso' },
      prev: { title: 'Intro' },
      next: { title: 'Segunda' },
      progress: { positionSec: 0, completed: false, favorite: false }
    })
    expect(view.assets.map((a) => [a.kind, a.name, a.lang])).toEqual([
      ['subtitle', '1. Primeira.pt.srt', 'pt'],
      ['attachment', '1. Primeira.pdf', null]
    ])
    expect(getLessonView(db, id('Segunda')).next?.title).toBe('Terceira') // atravessa módulos
    expect(getLessonView(db, id('Intro')).prev).toBeNull()
    expect(getLessonView(db, id('Terceira')).next).toBeNull()
  })

  it('erra para aula inexistente', () => {
    expect(() => getLessonView(db, 9999)).toThrow('Aula não encontrada')
  })
})

describe('saveProgress', () => {
  it('guarda posição e duração, e marca curso e aula como recentes', () => {
    saveProgress(db, { lessonId: id('Segunda'), positionSec: 42.5, durationSec: 600, watchedSec: 0 }, 1000)
    expect(getLessonView(db, id('Segunda'))).toMatchObject({ durationSec: 600, progress: { positionSec: 42.5 } })
    expect(listCourseSummaries(db)[0]).toMatchObject({ lastOpenedAt: 1000, resumeLessonId: id('Segunda'), durationSec: 600 })
  })

  it('junta tempo assistido contínuo numa sessão e abre outra após uma pausa longa', () => {
    const lessonId = id('Primeira')
    saveProgress(db, { lessonId, positionSec: 5, durationSec: null, watchedSec: 5 }, 1000)
    saveProgress(db, { lessonId, positionSec: 10, durationSec: null, watchedSec: 5 }, 1005)
    saveProgress(db, { lessonId, positionSec: 20, durationSec: null, watchedSec: 10 }, 2000)
    expect(sessions()).toEqual([
      { s: 995, e: 1005, seconds: 10 },
      { s: 1990, e: 2000, seconds: 10 }
    ])
  })

  it('não cria sessão quando nada foi assistido', () => {
    saveProgress(db, { lessonId: id('Primeira'), positionSec: 5, durationSec: null, watchedSec: 0 }, 1000)
    expect(sessions()).toEqual([])
  })
})

describe('concluído, favorito e duração', () => {
  it('liga e desliga', () => {
    const lessonId = id('Primeira')
    setCompleted(db, lessonId, true)
    setFavorite(db, lessonId, true)
    expect(getLessonView(db, lessonId).progress).toMatchObject({ completed: true, favorite: true })
    setCompleted(db, lessonId, false)
    expect(getLessonView(db, lessonId).progress.completed).toBe(false)
    expect(listCourseSummaries(db)[0].completedCount).toBe(0)
  })

  it('ignora durações inválidas', () => {
    setDuration(db, id('Primeira'), Number.NaN)
    setDuration(db, id('Primeira'), 0)
    expect(getLessonView(db, id('Primeira')).durationSec).toBeNull()
    setDuration(db, id('Primeira'), 123.4)
    expect(getLessonView(db, id('Primeira')).durationSec).toBe(123.4)
  })
})

describe('caminhos', () => {
  it('resolve arquivos de aula e anexo dentro da raiz', () => {
    expect(lessonFilePath(db, id('Primeira'))).toBe(join(root, '1. Mod', '1. Primeira.mp4'))
    const assetId = getLessonView(db, id('Primeira')).assets[0].id
    expect(assetFilePath(db, assetId)).toBe(join(root, '1. Mod', '1. Primeira.pt.srt'))
  })

  it('recusa caminhos que escapam da pasta do curso', () => {
    expect(() => resolveInside('/cursos/a', '../b/x.mp4')).toThrow('fora da pasta')
    expect(() => resolveInside('/cursos/a', '')).toThrow('fora da pasta')
    expect(resolveInside('/cursos/a', 'm/x.mp4')).toBe(resolve('/cursos/a/m/x.mp4'))
  })
})

describe('URLs do protocolo', () => {
  it('ida e volta', () => {
    expect(parseMediaUrl(mediaUrl.lesson(7))).toEqual({ type: 'lesson', id: 7 })
    expect(parseMediaUrl(mediaUrl.asset(3) + '/')).toEqual({ type: 'asset', id: 3 })
    expect(parseMediaUrl('tramotak-media://lesson/abc')).toBeNull()
    expect(parseMediaUrl('file:///etc/passwd')).toBeNull()
  })
})
