/** Itens da barra lateral. `soon` marca abas planejadas que ainda não existem. */
export type NavIcon =
  | 'home'
  | 'book'
  | 'search'
  | 'layers'
  | 'clipboard'
  | 'calendar'
  | 'activity'
  | 'notebook'
  | 'mindmap'
  | 'sparkles'
  | 'settings'

export interface NavItem {
  path: string
  label: string
  icon: NavIcon
  soon?: boolean
  /** Item que dispara uma ação em vez de navegar. */
  action?: 'search'
  /** Atalho mostrado ao lado do rótulo. */
  shortcut?: string
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Início', icon: 'home' },
  { path: '/courses', label: 'Meus Cursos', icon: 'book' },
  { path: '/search', label: 'Buscar', icon: 'search', action: 'search', shortcut: 'Ctrl K' },
  { path: '/flashcards', label: 'Flashcards', icon: 'layers' },
  { path: '/questions', label: 'Questões', icon: 'clipboard' },
  { path: '/planner', label: 'Planner', icon: 'calendar' },
  { path: '/progress', label: 'Progresso', icon: 'activity' },
  { path: '/notebooks', label: 'Cadernos', icon: 'notebook' },
  { path: '/mindmaps', label: 'Mapas Mentais', icon: 'mindmap' },
  { path: '/ai', label: 'IA', icon: 'sparkles', soon: true }
]

export const NAV_FOOTER: NavItem[] = [{ path: '/settings', label: 'Configurações', icon: 'settings' }]
