import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { LessonAssetView } from '@shared/course'
import { readPref, writePref } from '../../storage'
import { Modal } from '../Modal'
import { PdfReader } from './PdfReader'
import { useReadingTime } from './useReadingTime'

const lastPageKey = (lessonId: number, relPath: string) => `tramotak.pdf.page.${lessonId}.${relPath}`

/** Última página lida de um anexo PDF (só neste computador; não é progresso da aula). */
export function lastAttachmentPage(lessonId: number, relPath: string): number {
  const n = Number(readPref(lastPageKey(lessonId, relPath)))
  return Number.isInteger(n) && n >= 1 ? n : 1
}

/** Anexo PDF de uma aula no leitor do app: grifos e anotações ficam na aula, com a página e o nome do anexo. */
export function PdfAttachmentDialog({ lessonId, asset, page, onClose }: {
  lessonId: number
  asset: LessonAssetView
  /** Página para abrir; sem ela, a última lida. */
  page: number | null
  onClose: () => void
}) {
  const [initial] = useState(() => page ?? lastAttachmentPage(lessonId, asset.relPath))
  useReadingTime(lessonId, () => null)

  return (
    <Modal
      open
      onClose={onClose}
      title={asset.name}
      full
      headerExtra={
        <button
          type="button"
          onClick={() => window.api.files.openAsset(asset.id)}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text"
        >
          <ExternalLink size={14} /> Abrir no aplicativo do sistema
        </button>
      }
    >
      <PdfReader
        url={asset.url}
        pdfRef={{ lessonId, assetPath: asset.relPath }}
        initialPage={initial}
        onPageChange={(p) => writePref(lastPageKey(lessonId, asset.relPath), String(p))}
        className="h-full"
      />
    </Modal>
  )
}
