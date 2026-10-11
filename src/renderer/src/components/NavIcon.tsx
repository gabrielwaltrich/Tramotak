import {
  Activity,
  BookOpen,
  CalendarClock,
  ClipboardList,
  GitFork,
  Home,
  Layers,
  NotebookPen,
  Search,
  Settings,
  Sparkles,
  type LucideIcon
} from 'lucide-react'
import type { NavIcon as NavIconName } from '@shared/nav'

const ICONS: Record<NavIconName, LucideIcon> = {
  home: Home,
  book: BookOpen,
  search: Search,
  layers: Layers,
  clipboard: ClipboardList,
  calendar: CalendarClock,
  activity: Activity,
  notebook: NotebookPen,
  mindmap: GitFork,
  sparkles: Sparkles,
  settings: Settings
}

export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  const Icon = ICONS[name]
  return <Icon className={className} size={18} strokeWidth={1.75} aria-hidden />
}
