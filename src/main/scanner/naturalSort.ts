const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })

/** Ordenação natural: "2 Aula" vem antes de "10 Aula"; ignora maiúsculas e acentos. */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b)
}
