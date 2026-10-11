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
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Início', icon: 'home' },
  { path: '/courses', label: 'Meus Cursos', icon: 'book' },
  { path: '/search', label: 'Buscar', icon: 'search', soon: true },
  { path: '/flashcards', label: 'Flashcards', icon: 'layers', soon: true },
  { path: '/questions', label: 'Questões', icon: 'clipboard', soon: true },
  { path: '/planner', label: 'Planner', icon: 'calendar', soon: true },
  { path: '/progress', label: 'Progresso', icon: 'activity', soon: true },
  { path: '/notebooks', label: 'Cadernos', icon: 'notebook', soon: true },
  { path: '/mindmaps', label: 'Mapas Mentais', icon: 'mindmap', soon: true },
  { path: '/ai', label: 'IA', icon: 'sparkles', soon: true }
]

export const NAV_FOOTER: NavItem[] = [{ path: '/settings', label: 'Configurações', icon: 'settings' }]
