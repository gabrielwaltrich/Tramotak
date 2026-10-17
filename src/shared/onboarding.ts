/**
 * Primeira execução: boas-vindas em 3 passos, lista de "Primeiros passos" no Início e o curso de exemplo
 * ("Como usar o Tramotak", com um baralho e um banco de questões ligados às aulas). Lógica pura e dados.
 */
import type { QuestionInput } from './questions'

export const SAMPLE_COURSE_TITLE = 'Como usar o Tramotak'
export const SAMPLE_SET_TITLE = `Exemplo — ${SAMPLE_COURSE_TITLE}`

/** Cartas do baralho de exemplo; `lesson` é o caminho da aula no curso (a carta fica ligada a ela). */
export const SAMPLE_CARDS: { front: string; back: string; lesson: string }[] = [
  {
    front: 'O que é recordação ativa?',
    back: 'Tentar lembrar a resposta antes de vê-la. Fixa mais do que reler o material.',
    lesson: '03. Revisar e praticar/01. Flashcards e revisão espaçada.md'
  },
  {
    front: 'Na revisão espaçada, quando uma carta volta para revisão?',
    back: 'Pouco antes de você esquecê-la: cartas fáceis voltam em intervalos cada vez maiores, as difíceis voltam logo.',
    lesson: '03. Revisar e praticar/01. Flashcards e revisão espaçada.md'
  },
  {
    front: 'O que a retenção desejada de um baralho controla?',
    back: 'A chance de lembrar da carta no dia em que ela volta. Mais alta = mais revisões por dia.',
    lesson: '03. Revisar e praticar/01. Flashcards e revisão espaçada.md'
  },
  {
    front: 'Qual tecla abre a janela flutuante do vídeo?',
    back: 'P. A janela fica por cima dos outros programas.',
    lesson: '01. Primeiros passos/02. O player de vídeo.mp4'
  },
  {
    front: 'Por que escrever anotações com as próprias palavras ajuda a aprender?',
    back: 'Obriga a reorganizar a informação, e isso fixa mais do que só assistir ou reler.',
    lesson: '02. Estudar com o material/01. Anotações e cadernos.md'
  }
]

export const SAMPLE_QUESTIONS: QuestionInput[] = [
  {
    type: 'single',
    statement: 'Qual destas técnicas usa a recordação ativa?',
    options: [
      { id: 'o1', text: 'Reler o capítulo inteiro' },
      { id: 'o2', text: 'Responder um flashcard antes de virar a carta' },
      { id: 'o3', text: 'Grifar tudo o que parece importante' },
      { id: 'o4', text: 'Assistir à aula em velocidade maior' }
    ],
    key: { type: 'single', correct: 'o2' },
    explanation: 'Na recordação ativa você tenta lembrar antes de ver a resposta; reler e grifar são passivos.',
    topic: 'Recordação ativa',
    difficulty: 2,
    points: 1
  },
  {
    type: 'truefalse',
    statement: 'Na revisão espaçada, todas as cartas voltam todos os dias até você decorar.',
    options: [],
    key: { type: 'truefalse', correct: false },
    explanation: 'Cada carta volta pouco antes de ser esquecida; as fáceis ficam cada vez mais tempo sem voltar.',
    topic: 'Revisão espaçada',
    difficulty: 1,
    points: 1
  },
  {
    type: 'multiple',
    statement: 'Quais destas são boas práticas para escrever flashcards?',
    options: [
      { id: 'o1', text: 'Uma ideia por carta' },
      { id: 'o2', text: 'Pergunta direta e resposta curta' },
      { id: 'o3', text: 'Copiar parágrafos inteiros no verso' },
      { id: 'o4', text: 'Preferir perguntas de sim ou não' }
    ],
    key: { type: 'multiple', correct: ['o1', 'o2'] },
    explanation: 'Cartas curtas e com uma ideia só são mais fáceis de revisar; sim/não e parágrafos longos atrapalham.',
    topic: 'Flashcards',
    difficulty: 2,
    points: 1
  }
]

/** O que o app criou para o exemplo (para abrir e para remover). */
export interface SampleInfo {
  courseId: number
  deckId: number | null
  bankId: number | null
}

export type FirstStepId = 'course' | 'watch' | 'note' | 'cards' | 'exam' | 'ai'

export interface FirstStep {
  id: FirstStepId
  label: string
  hint: string
  done: boolean
}

export interface OnboardingView {
  /** Mostrar as boas-vindas agora. */
  showWelcome: boolean
  /** Lista do Início (`null` = não mostrar). */
  steps: FirstStep[] | null
  sample: SampleInfo | null
}

/** Estado guardado (`internal.onboarding`). */
export interface OnboardingState {
  /** 'requested' = abertas até a pessoa concluir: pediu para ver de novo (Configurações → Sobre) ou já está nelas. */
  welcome: 'pending' | 'done' | 'requested'
  /** As boas-vindas foram concluídas ou puladas ao menos uma vez (só então a lista aparece). */
  started: boolean
  stepsDismissed: boolean
}

export const DEFAULT_ONBOARDING: OnboardingState = { welcome: 'pending', started: false, stepsDismissed: false }

export function normalizeOnboarding(raw: unknown): OnboardingState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<OnboardingState>
  return {
    welcome: r.welcome === 'done' || r.welcome === 'requested' ? r.welcome : 'pending',
    started: r.started === true,
    stepsDismissed: r.stepsDismissed === true
  }
}

/** O que já foi feito no app (contado no banco). */
export interface UsageFacts {
  /** Cursos fora o exemplo. */
  ownCourses: number
  /** Todos os cursos, com o exemplo. */
  courses: number
  watched: boolean
  notes: boolean
  cardReviews: boolean
  examAttempts: boolean
  aiConfigured: boolean
}

const STEPS: Omit<FirstStep, 'done'>[] = [
  { id: 'course', label: 'Importe um curso seu', hint: 'A pasta de um curso que já está no computador' },
  { id: 'watch', label: 'Assista a uma aula', hint: 'O vídeo do curso de exemplo serve' },
  { id: 'note', label: 'Faça uma anotação', hint: 'Na aba Anotações, ao lado do player' },
  { id: 'cards', label: 'Revise flashcards', hint: 'Responda algumas cartas de um baralho' },
  { id: 'exam', label: 'Faça um simulado', hint: 'Escolha um banco de questões e comece' },
  { id: 'ai', label: 'Configure a IA (opcional)', hint: 'Gemini é grátis com a conta Google' }
]

/**
 * Boas-vindas só para quem ainda não tem cursos (instalação nova ou banco vazio) ou quando a pessoa pede de novo;
 * quem já usa o app nunca é interrompido. A lista aparece depois das boas-vindas até ser dispensada ou concluída.
 */
export function onboardingView(state: OnboardingState, facts: UsageFacts, sample: SampleInfo | null): OnboardingView {
  const showWelcome = state.welcome === 'requested' || (state.welcome === 'pending' && facts.courses === 0)
  const done: Record<FirstStepId, boolean> = {
    course: facts.ownCourses > 0,
    watch: facts.watched,
    note: facts.notes,
    cards: facts.cardReviews,
    exam: facts.examAttempts,
    ai: facts.aiConfigured
  }
  const steps = STEPS.map((s) => ({ ...s, done: done[s.id] }))
  const visible = state.started && !state.stepsDismissed && steps.some((s) => !s.done)
  return { showWelcome, steps: visible ? steps : null, sample }
}

/** Metas sugeridas no primeiro passo das boas-vindas (minutos por dia). */
export const GOAL_CHOICES = [15, 30, 60, 90]
