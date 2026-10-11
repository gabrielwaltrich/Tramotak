import { createContext, useContext } from 'react'

export const SearchContext = createContext<{ open: () => void }>({ open: () => {} })

export function useSearch() {
  return useContext(SearchContext)
}
