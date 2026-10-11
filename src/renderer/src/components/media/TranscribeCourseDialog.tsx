import { Link } from 'react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2, Mic } from 'lucide-react'
import { plural } from '@shared/format'
import { errorMessage, queryKeys } from '../../lib/api'
import { Modal } from '../Modal'
import { Button } from '../Button'
import { useToast } from '../Toast'

const PROVIDER_NOTE: Record<string, string> = {
  builtin: 'Transcrição no seu computador (Whisper embutido): grátis e sem internet, mas usa bastante o processador. Aulas longas levam alguns minutos cada.',
  groq: 'O plano gratuito do Groq tem limite de horas de áudio por dia: aulas que baterem no limite ficam com erro e podem ser repetidas depois ("Repetir com erro").',
  local: 'O áudio vai para o seu servidor Whisper local.'
}

/** Confirmação para transcrever todas as aulas de vídeo do curso que ainda não têm transcrição. */
export function TranscribeCourseDialog({ courseId, onClose }: { courseId: number; onClose: () => void }) {
  const toast = useToast()
  const missing = useQuery({ queryKey: ['untranscribed', courseId], queryFn: () => window.api.media.untranscribed(courseId), staleTime: 0 })
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: () => window.api.settings.get(), staleTime: 0 })
  const provider = settings.data?.transcriptionProvider ?? 'none'
  const start = useMutation({
    mutationFn: () => window.api.media.transcribeCourse(courseId),
    onSuccess: (added) => {
      toast(added ? `${plural(added, 'aula entrou', 'aulas entraram')} na fila de transcrição` : 'Nada novo para transcrever')
      onClose()
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })

  return (
    <Modal
      open
      onClose={onClose}
      title="Transcrever o curso"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => start.mutate()} disabled={start.isPending || !missing.data || provider === 'none'}>
            {start.isPending ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />} Transcrever
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {missing.isPending ? (
          <Loader2 className="mx-auto animate-spin text-muted" />
        ) : missing.data === 0 ? (
          <p>Todas as aulas de vídeo deste curso já têm transcrição.</p>
        ) : (
          <p>
            <b>{plural(missing.data ?? 0, 'aula de vídeo', 'aulas de vídeo')}</b> ainda sem transcrição. Elas entram numa fila e são transcritas uma por vez, em segundo plano; você pode
            continuar usando o app e acompanhar ou cancelar pelo indicador na barra lateral.
          </p>
        )}
        {provider === 'none' ? (
          <p className="text-warning">
            Escolha como transcrever em{' '}
            <Link to="/settings" className="underline" onClick={onClose}>
              Configurações → Vídeo e transcrição
            </Link>
            .
          </p>
        ) : (
          <p className="text-xs text-muted">{PROVIDER_NOTE[provider]}</p>
        )}
      </div>
    </Modal>
  )
}
