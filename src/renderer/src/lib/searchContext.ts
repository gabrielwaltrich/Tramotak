import { createContext, useContext } from 'react'

/** Abre a busca global; `initial` já entra no campo (ex.: a letra digitada na barra de pesquisa). */
export const SearchContext = createContext<{ open: (initial?: string) => void }>({ open: () => {} })

export function useSearch() {
  return useContext(SearchContext)
}
