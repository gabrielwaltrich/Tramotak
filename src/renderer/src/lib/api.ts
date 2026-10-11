/** Mensagem legível de um erro vindo do IPC (remove o prefixo técnico do Electron). */
export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

export const queryKeys = {
  dashboard: ['dashboard'] as const,
  settings: ['settings'] as const,
  courses: ['courses'] as const,
  course: (id: number) => ['courses', id] as const,
  lesson: (id: number) => ['lessons', id] as const,
  notes: (lessonId: number) => ['notes', lessonId] as const,
  search: (text: string) => ['search', text] as const,
  decks: ['decks'] as const,
  deck: (id: number) => ['decks', id] as const,
  study: (deckId: number) => ['study', deckId] as const,
  tasks: ['tasks'] as const,
  tasksToday: ['tasks', 'today'] as const,
  calendar: (from: string, to: string) => ['tasks', 'calendar', from, to] as const,
  stats: ['stats'] as const,
  history: (filter: object) => ['stats', 'history', filter] as const
}
