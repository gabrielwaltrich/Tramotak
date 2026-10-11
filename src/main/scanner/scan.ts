import { readdir, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type {
  Numbering,
  ScannedAsset,
  ScannedLesson,
  ScannedModule,
  ScanOptions,
  ScanResult,
  ScanStats,
  ScanWarning
} from '@shared/course'
import { classify, RISKY_VIDEO_EXTS, type FileClass } from './files'
import { naturalCompare } from './naturalSort'
import { matchSubtitle } from './subtitles'
import { cleanTitle } from './titles'

/** Profundidade máxima de módulos: módulo → submódulo. */
const MAX_DEPTH = 2
/** Acima disso o Windows pode falhar sem suporte a caminhos longos. */
const LONG_PATH = 240

interface FileEntry {
  name: string
  rel: string
  cls: FileClass
  size: number
  mtimeMs: number
}

interface DirNode {
  name: string
  rel: string
  dirs: DirNode[]
  files: FileEntry[]
}

const joinRel = (parent: string, name: string) => (parent ? `${parent}/${name}` : name)
const baseName = (name: string) => name.slice(0, name.length - extname(name).length)
const isLessonFile = (f: FileEntry) => f.cls === 'video' || f.cls === 'text' || f.cls === 'document'

async function readTree(abs: string, rel: string, name: string, warnings: ScanWarning[]): Promise<DirNode> {
  const node: DirNode = { name, rel, dirs: [], files: [] }
  let entries
  try {
    entries = await readdir(abs, { withFileTypes: true })
  } catch {
    warnings.push({ code: 'unreadable', message: 'Pasta sem permissão de leitura', relPath: rel })
    return node
  }

  await Promise.all(
    entries.map(async (entry) => {
      const childRel = joinRel(rel, entry.name)
      const childAbs = join(abs, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) return
        node.dirs.push(await readTree(childAbs, childRel, entry.name, warnings))
      } else if (entry.isFile()) {
        const cls = classify(entry.name)
        if (cls === 'ignored') return
        const info = await stat(childAbs)
        node.files.push({ name: entry.name, rel: childRel, cls, size: info.size, mtimeMs: Math.trunc(info.mtimeMs) })
      }
      // Links simbólicos são ignorados para evitar ciclos.
    })
  )

  node.dirs.sort((a, b) => naturalCompare(a.name, b.name))
  node.files.sort((a, b) => naturalCompare(a.name, b.name))
  return node
}

/** Pasta-aula: sem subpastas e com exatamente um vídeo (o resto vira anexo). */
function isLessonFolder(dir: DirNode): boolean {
  return dir.dirs.length === 0 && dir.files.filter((f) => f.cls === 'video').length === 1
}

/** No modo auto, filhos viram aulas quando há 2+ pastas e todas são pastas-aula. */
function hasLessonFolderChildren(dir: DirNode): boolean {
  return dir.dirs.length >= 2 && dir.dirs.every(isLessonFolder)
}

function lessonFromFolder(dir: DirNode, numbering: Numbering): ScannedLesson {
  const video = dir.files.find((f) => f.cls === 'video')!
  const videoBase = baseName(video.name)
  const assets: ScannedAsset[] = []
  for (const f of dir.files) {
    if (f === video) continue
    if (f.cls === 'subtitle') {
      const lang = matchSubtitle(videoBase, f.name)
      assets.push({ kind: 'subtitle', relPath: f.rel, lang: lang ?? null })
    } else {
      assets.push({ kind: 'attachment', relPath: f.rel, lang: null })
    }
  }
  return {
    title: cleanTitle(dir.name, numbering, false),
    relPath: video.rel,
    kind: 'video',
    size: video.size,
    mtimeMs: video.mtimeMs,
    assets
  }
}

/** Aulas a partir dos arquivos de UMA pasta (legendas e anexos casam pelo nome-base). */
function lessonsFromFiles(files: FileEntry[], numbering: Numbering): { name: string; lesson: ScannedLesson }[] {
  const videos = files.filter((f) => f.cls === 'video')
  const videoBases = new Map(videos.map((v) => [baseName(v.name), v]))
  const assetsByVideo = new Map<FileEntry, ScannedAsset[]>(videos.map((v) => [v, []]))
  const out: { name: string; lesson: ScannedLesson }[] = []

  for (const f of files) {
    if (f.cls === 'subtitle') {
      for (const [base, video] of videoBases) {
        const lang = matchSubtitle(base, f.name)
        if (lang !== undefined) {
          assetsByVideo.get(video)!.push({ kind: 'subtitle', relPath: f.rel, lang })
          break
        }
      }
      continue // legenda sem vídeo correspondente é descartada
    }
    if (f.cls === 'document' || f.cls === 'text') {
      const owner = videoBases.get(baseName(f.name))
      if (owner) {
        assetsByVideo.get(owner)!.push({ kind: 'attachment', relPath: f.rel, lang: null })
        continue
      }
    }
    if (!isLessonFile(f)) continue
    out.push({
      name: f.name,
      lesson: {
        title: cleanTitle(f.name, numbering),
        relPath: f.rel,
        kind: f.cls === 'video' ? 'video' : f.cls === 'text' ? 'text' : 'document',
        size: f.size,
        mtimeMs: f.mtimeMs,
        assets: []
      }
    })
  }

  for (const item of out) {
    const video = videos.find((v) => v.rel === item.lesson.relPath)
    if (video) item.lesson.assets = assetsByVideo.get(video)!
  }
  return out
}

/** Todas as aulas de uma subárvore, em ordem natural de caminho (usado ao achatar). */
function flatten(dir: DirNode, numbering: Numbering, collapse: boolean): ScannedLesson[] {
  const own = ownLessons(dir, numbering, collapse).map((i) => i.lesson)
  // Pastas-aula já entraram em ownLessons; só desce nas demais.
  const nested = collapse && hasLessonFolderChildren(dir) ? [] : dir.dirs.flatMap((d) => flatten(d, numbering, collapse))
  return [...own, ...nested]
}

/** Aulas que pertencem diretamente a `dir`: arquivos soltos + pastas-aula colapsadas. */
function ownLessons(dir: DirNode, numbering: Numbering, collapse: boolean) {
  const items = lessonsFromFiles(dir.files, numbering)
  if (collapse && hasLessonFolderChildren(dir)) {
    for (const child of dir.dirs) items.push({ name: child.name, lesson: lessonFromFolder(child, numbering) })
  }
  return items.sort((a, b) => naturalCompare(a.name, b.name))
}

function hasLessons(dir: DirNode): boolean {
  return dir.files.some(isLessonFile) || dir.dirs.some(hasLessons)
}

/** Nível mais profundo (raiz = 0) onde aparecem aulas, considerando pastas-aula. */
function deepestLessonLevel(dir: DirNode, level: number): number {
  let deepest = dir.files.some(isLessonFile) || hasLessonFolderChildren(dir) ? level : -1
  if (!hasLessonFolderChildren(dir)) {
    for (const child of dir.dirs) deepest = Math.max(deepest, deepestLessonLevel(child, level + 1))
  }
  return deepest
}

function buildModule(
  dir: DirNode,
  level: number,
  maxDepth: number,
  numbering: Numbering,
  collapse: boolean,
  warnings: ScanWarning[]
): ScannedModule {
  const lessons = ownLessons(dir, numbering, collapse).map((i) => i.lesson)
  const children: ScannedModule[] = []

  if (!(collapse && hasLessonFolderChildren(dir))) {
    for (const child of dir.dirs) {
      if (!hasLessons(child)) continue
      if (level < maxDepth) {
        children.push(buildModule(child, level + 1, maxDepth, numbering, collapse, warnings))
      } else {
        lessons.push(...flatten(child, numbering, collapse))
        warnings.push({
          code: 'flattened',
          message: 'Subpasta além da profundidade escolhida: as aulas foram incluídas no nível acima',
          relPath: child.rel
        })
      }
    }
  }

  return { title: cleanTitle(dir.name, numbering, false), relPath: dir.rel, lessons, children }
}

function collectStats(result: Pick<ScanResult, 'lessons' | 'modules'>, tree: DirNode): ScanStats {
  const stats: ScanStats = { modules: 0, lessons: 0, videos: 0, subtitles: 0, attachments: 0, totalBytes: 0 }
  const countLessons = (lessons: ScannedLesson[]) => {
    for (const l of lessons) {
      stats.lessons++
      if (l.kind === 'video') stats.videos++
      for (const a of l.assets) {
        if (a.kind === 'subtitle') stats.subtitles++
        else stats.attachments++
      }
    }
  }
  const walkModules = (mods: ScannedModule[]) => {
    for (const m of mods) {
      stats.modules++
      countLessons(m.lessons)
      walkModules(m.children)
    }
  }
  const sumBytes = (d: DirNode) => {
    for (const f of d.files) stats.totalBytes += f.size
    d.dirs.forEach(sumBytes)
  }
  countLessons(result.lessons)
  walkModules(result.modules)
  sumBytes(tree)
  return stats
}

function collectFileWarnings(root: string, result: Pick<ScanResult, 'lessons' | 'modules'>, warnings: ScanWarning[]) {
  const visit = (lessons: ScannedLesson[]) => {
    for (const l of lessons) {
      if (l.kind === 'video' && RISKY_VIDEO_EXTS.has(extname(l.relPath).toLowerCase())) {
        warnings.push({ code: 'maybe-unsupported', message: 'Formato de vídeo que pode não tocar no player', relPath: l.relPath })
      }
      for (const rel of [l.relPath, ...l.assets.map((a) => a.relPath)]) {
        if (join(root, rel).length > LONG_PATH) {
          warnings.push({ code: 'long-path', message: 'Caminho muito longo: pode falhar no Windows', relPath: rel })
        }
      }
    }
  }
  const walk = (mods: ScannedModule[]) => mods.forEach((m) => (visit(m.lessons), walk(m.children)))
  visit(result.lessons)
  walk(result.modules)
}

/** Lê a pasta de um curso e monta a árvore de módulos/aulas. Não altera nada no disco. */
export async function scanCourse(root: string, options: ScanOptions): Promise<ScanResult> {
  const warnings: ScanWarning[] = []
  const tree = await readTree(root, '', '', warnings)
  const collapse = options.structure === 'auto'

  const maxDepth =
    options.structure === 'flat' ? 0
    : options.structure === 'modules' ? 1
    : options.structure === 'submodules' ? 2
    : Math.min(Math.max(deepestLessonLevel(tree, 0), 0), MAX_DEPTH)

  const rootModule = buildModule(tree, 0, maxDepth, options.numbering, collapse, warnings)
  const result = { lessons: rootModule.lessons, modules: rootModule.children }

  collectFileWarnings(root, result, warnings)
  const stats = collectStats(result, tree)
  if (stats.lessons === 0) {
    warnings.unshift({ code: 'empty', message: 'Nenhuma aula encontrada nesta pasta' })
  }

  const structure = maxDepth === 0 ? 'flat' : maxDepth === 1 ? 'modules' : 'submodules'
  return { structure, ...result, warnings, stats }
}
