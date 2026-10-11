/** Mensagem legível de um erro vindo do IPC (remove o prefixo técnico do Electron). */
export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

export const queryKeys = {
  courses: ['courses'] as const,
  course: (id: number) => ['courses', id] as const
}
