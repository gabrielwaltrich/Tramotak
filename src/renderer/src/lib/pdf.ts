import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { pdfjsAssetBase } from '@shared/media'
import { normalize } from '@shared/search'

GlobalWorkerOptions.workerSrc = workerUrl

/**
 * Abre um PDF servido pelo protocolo do app. Fontes padrão, mapas de caracteres e decodificadores de imagem
 * também vêm do app (nada da internet). Sem scripts nem formulários XFA: o PDF só é lido.
 */
export function openPdf(url: string): PDFDocumentLoadingTask {
  return getDocument({
    url,
    cMapUrl: `${pdfjsAssetBase}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${pdfjsAssetBase}standard_fonts/`,
    wasmUrl: `${pdfjsAssetBase}wasm/`,
    iccUrl: `${pdfjsAssetBase}iccs/`,
    enableXfa: false
  })
}

/** 100% de zoom = tamanho real da página (1 pt do PDF = 96/72 px). */
export const PDF_TO_CSS = 96 / 72
export const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]

export function nextZoom(zoom: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((z) => z > zoom + 0.001) ?? ZOOM_STEPS.at(-1)!
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom - 0.001) ?? ZOOM_STEPS[0]
}

/** Texto para buscar: sem acento, minúsculo, espaços simples. */
export const searchable = (text: string): string => normalize(text).replace(/\s+/g, ' ')
