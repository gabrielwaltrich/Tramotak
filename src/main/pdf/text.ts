import { readFile, stat } from 'node:fs/promises'
import { cleanPageText } from '@shared/pdf'

/** PDFs maiores que isso não são lidos para a IA (o leitor abre normalmente). */
export const MAX_PDF_BYTES = 200 * 1024 * 1024
const MAX_PAGES = 2000
const CACHE_SIZE = 12

type PdfModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
let pdfjs: Promise<PdfModule> | null = null

// O pdf.js é ESM e pesado: só carrega quando um PDF é lido pela primeira vez. No Node não há canvas (nem
// precisa): os avisos de polyfill de desenho são esperados e a extração de texto não depende deles.
function loadPdfjs(): Promise<PdfModule> {
  pdfjs ??= import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjs
}

const cache = new Map<string, Promise<string[]>>()

/**
 * Texto de cada página do PDF (índice 0 = página 1). PDF escaneado (só imagem) devolve páginas vazias.
 * Fica em memória por arquivo, tamanho e data de modificação.
 */
export async function pdfPagesText(path: string): Promise<string[]> {
  const info = await stat(path)
  if (info.size > MAX_PDF_BYTES) throw new Error('PDF grande demais para a IA ler')
  const key = `${path}\0${info.size}\0${info.mtimeMs}`
  let pending = cache.get(key)
  if (!pending) {
    pending = extract(path)
    cache.set(key, pending)
    pending.catch(() => cache.delete(key))
    while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
  }
  return pending
}

async function extract(path: string): Promise<string[]> {
  const { getDocument } = await loadPdfjs()
  const data = new Uint8Array(await readFile(path))
  const task = getDocument({ data, verbosity: 0, useWorkerFetch: false, disableFontFace: true })
  const doc = await task.promise
  try {
    const pages: string[] = []
    for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGES); i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      pages.push(cleanPageText(content.items.filter((it): it is { str: string; hasEOL: boolean } & typeof it => 'str' in it)))
      page.cleanup()
    }
    return pages
  } finally {
    await task.destroy()
  }
}
