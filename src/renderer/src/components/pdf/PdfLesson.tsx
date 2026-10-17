import { useCallback, useRef, type RefObject } from 'react'
import type { LessonView } from '@shared/course'
import { PdfReader, type PdfController } from './PdfReader'
import { useReadingTime } from './useReadingTime'

/** Aula que é um PDF: o leitor do app, guardando a última página lida e o tempo de leitura. */
export function PdfLesson({ lesson, initialPage, controllerRef, onReachEnd, onPageChange }: {
  lesson: LessonView
  initialPage: number
  controllerRef: RefObject<PdfController | null>
  onReachEnd: () => void
  onPageChange?: (page: number) => void
}) {
  const page = useRef(initialPage)
  useReadingTime(lesson.id, () => page.current)
  const changed = useCallback(
    (p: number) => {
      page.current = p
      onPageChange?.(p)
    },
    [onPageChange]
  )
  return (
    <PdfReader
      url={lesson.url}
      pdfRef={{ lessonId: lesson.id, assetPath: null }}
      initialPage={initialPage}
      onPageChange={changed}
      onReachEnd={onReachEnd}
      controllerRef={controllerRef}
      className="h-[78vh]"
    />
  )
}
