import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Check, FolderPlus, Loader2, Sparkles } from 'lucide-react'
import { GOAL_CHOICES } from '@shared/onboarding'
import { errorMessage, queryKeys } from '../../lib/api'
import { Button } from '../Button'
import { Modal } from '../Modal'
import { useToast } from '../Toast'

const TITLES = ['Boas-vindas ao Tramotak', 'Seu primeiro curso', 'Inteligência artificial (opcional)']

/**
 * Primeira execução: meta diária → curso (exemplo ou um seu) → IA. Aparece sozinha só para quem ainda não tem cursos;
 * pular ou fechar conta como concluída (a lista "Primeiros passos" do Início continua guiando).
 */
export function WelcomeDialog() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [step, setStep] = useState(0)
  const onboarding = useQuery({ queryKey: queryKeys.onboarding, queryFn: () => window.api.onboarding.get(), staleTime: 0 })
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: () => window.api.settings.get() })
  const [goal, setGoal] = useState<number | null>(null)
  const chosenGoal = goal ?? settings.data?.dailyGoalMinutes ?? 60

  const refresh = () => {
    for (const key of [queryKeys.onboarding, queryKeys.courses, queryKeys.decks, queryKeys.dashboard, queryKeys.settings]) void queryClient.invalidateQueries({ queryKey: key })
    void queryClient.invalidateQueries({ queryKey: ['banks'] })
  }
  const finish = useMutation({
    mutationFn: async (to: string | null) => {
      await window.api.onboarding.finish()
      return to
    },
    onSuccess: (to) => {
      setStep(0)
      refresh()
      if (to) navigate(to)
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const saveGoal = useMutation({
    mutationFn: () => window.api.settings.update({ dailyGoalMinutes: chosenGoal }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings })
      setStep(1)
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const sample = useMutation({
    mutationFn: () => window.api.onboarding.installSample(),
    onSuccess: refresh,
    onError: (error) => toast(errorMessage(error), 'error')
  })

  const installed = onboarding.data?.sample ?? sample.data ?? null
  const open = onboarding.data?.showWelcome === true
  const skip = () => finish.mutate(null)

  return (
    <Modal
      open={open}
      onClose={skip}
      wide
      title={TITLES[step]}
      headerExtra={
        <button type="button" onClick={skip} className="text-xs text-muted hover:text-text">
          Pular introdução
        </button>
      }
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-xs text-muted">Passo {step + 1} de 3</span>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={finish.isPending}>
                Voltar
              </Button>
            )}
            {step === 0 && (
              <Button onClick={() => saveGoal.mutate()} disabled={saveGoal.isPending} data-autofocus>
                Continuar
              </Button>
            )}
            {step === 1 && (
              <Button onClick={() => setStep(2)} data-autofocus>
                Continuar
              </Button>
            )}
            {step === 2 && (
              <Button onClick={() => finish.mutate(installed ? `/courses/${installed.courseId}` : '/')} disabled={finish.isPending} data-autofocus>
                Começar a estudar
              </Button>
            )}
          </div>
        </div>
      }
    >
      {step === 0 && (
        <div className="space-y-4 text-sm">
          <p>
            O Tramotak organiza os cursos que <b>já estão no seu computador</b> (pastas com vídeos, PDFs e textos): guarda o progresso, as anotações com o minuto do
            vídeo e ajuda a revisar com flashcards e simulados. Os arquivos dos cursos nunca são alterados.
          </p>
          <div>
            <p className="mb-2 font-medium">Quanto tempo você quer estudar por dia?</p>
            <div role="radiogroup" aria-label="Meta diária" className="flex flex-wrap gap-2">
              {GOAL_CHOICES.map((min) => (
                <button
                  key={min}
                  type="button"
                  role="radio"
                  aria-checked={chosenGoal === min}
                  onClick={() => setGoal(min)}
                  className={`rounded-lg border px-4 py-2 text-sm transition ${chosenGoal === min ? 'border-accent bg-accent/10 text-text' : 'border-border text-muted hover:text-text'}`}
                >
                  {min} min
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">Aparece no Início e conta a sua sequência de dias. Dá para mudar depois em Configurações.</p>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
            <p className="inline-flex items-center gap-2 font-medium">
              <BookOpen size={16} /> Curso de exemplo
            </p>
            <p className="flex-1 text-muted">
              “Como usar o Tramotak”: um vídeo curto com legenda, um PDF e textos, com um baralho e um banco de questões de exemplo. Bom para experimentar sem medo; dá para
              remover depois.
            </p>
            {installed ? (
              <p className="inline-flex items-center gap-2 text-success">
                <Check size={16} /> Pronto: curso, baralho e banco de exemplo
              </p>
            ) : (
              <Button onClick={() => sample.mutate()} disabled={sample.isPending}>
                {sample.isPending ? <Loader2 size={16} className="animate-spin" /> : <BookOpen size={16} />} Usar o curso de exemplo
              </Button>
            )}
          </section>
          <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
            <p className="inline-flex items-center gap-2 font-medium">
              <FolderPlus size={16} /> Um curso seu
            </p>
            <p className="flex-1 text-muted">
              Escolha a pasta de um curso. Cada subpasta vira um módulo e cada vídeo, PDF ou texto vira uma aula, na ordem dos números dos nomes.
            </p>
            <Button variant="ghost" onClick={() => finish.mutate('/courses?import=1')} disabled={finish.isPending}>
              <FolderPlus size={16} /> Importar um curso meu
            </Button>
          </section>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3 text-sm">
          <p>
            Com a IA, o Tramotak gera flashcards, questões, resumos e mapas mentais das aulas e responde perguntas citando a aula e o minuto. Ela lê só o conteúdo das
            aulas (fala, texto e PDF), nunca títulos nem nomes de arquivos.
          </p>
          <p className="text-muted">
            É opcional e usa a sua conta: o <b>Gemini</b> é grátis com a conta Google, o <b>Ollama</b> roda no seu computador e há opções pagas (Claude, OpenRouter).
          </p>
          <Button variant="ghost" onClick={() => finish.mutate('/settings#ai')} disabled={finish.isPending}>
            <Sparkles size={16} /> Configurar a IA agora
          </Button>
        </div>
      )}
    </Modal>
  )
}
