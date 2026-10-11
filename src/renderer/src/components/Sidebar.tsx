import { useState } from 'react'
import { NavLink } from 'react-router'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { NAV_FOOTER, NAV_ITEMS, type NavItem } from '@shared/nav'
import { NavIcon } from './NavIcon'
import { readPref, writePref } from '../storage'
import { useSearch } from '../lib/searchContext'
import { JobsIndicator } from './media/JobsIndicator'

const KEY = 'tramotak.sidebar.collapsed'

function Item({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const base =
    'flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors whitespace-nowrap'

  if (item.action) {
    return <ActionItem item={item} collapsed={collapsed} className={base} />
  }

  if (item.soon) {
    return (
      <div
        className={`${base} cursor-not-allowed text-muted/60`}
        title={`${item.label} (em breve)`}
        aria-disabled
      >
        <NavIcon name={item.icon} className="shrink-0" />
        {!collapsed && (
          <>
            <span className="truncate">{item.label}</span>
            <span className="ml-auto rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
              em breve
            </span>
          </>
        )}
      </div>
    )
  }

  return (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        `${base} ${isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-surface-2 hover:text-text'}`
      }
    >
      <NavIcon name={item.icon} className="shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  )
}

function ActionItem({ item, collapsed, className }: { item: NavItem; collapsed: boolean; className: string }) {
  const search = useSearch()
  const isMac = navigator.platform.toLowerCase().includes('mac')
  return (
    <button
      type="button"
      onClick={search.open}
      title={collapsed ? item.label : undefined}
      className={`${className} w-full text-muted hover:bg-surface-2 hover:text-text`}
    >
      <NavIcon name={item.icon} className="shrink-0" />
      {!collapsed && (
        <>
          <span className="truncate">{item.label}</span>
          {item.shortcut && (
            <kbd className="ml-auto rounded border border-border px-1.5 text-[10px] tracking-wide">
              {isMac ? item.shortcut.replace('Ctrl', '⌘') : item.shortcut}
            </kbd>
          )}
        </>
      )}
    </button>
  )
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => readPref(KEY) === '1')

  const toggle = () => {
    setCollapsed((value) => {
      writePref(KEY, value ? '0' : '1')
      return !value
    })
  }

  return (
    <aside
      className={`flex shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-150 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      <div className="flex h-14 items-center gap-2 px-4">
        <div className="grid size-7 shrink-0 place-items-center rounded-md bg-accent text-sm font-bold text-white">
          T
        </div>
        {!collapsed && <span className="font-semibold tracking-tight">Tramotak</span>}
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2" aria-label="Principal">
        {NAV_ITEMS.map((item) => (
          <Item key={item.path} item={item} collapsed={collapsed} />
        ))}
      </nav>

      <div className="flex flex-col gap-0.5 border-t border-border px-2 py-2">
        <JobsIndicator collapsed={collapsed} />
        {NAV_FOOTER.map((item) => (
          <Item key={item.path} item={item} collapsed={collapsed} />
        ))}
        <button
          type="button"
          onClick={toggle}
          className="flex h-9 items-center gap-3 rounded-md px-3 text-sm text-muted hover:bg-surface-2 hover:text-text"
          aria-label={collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
        >
          {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
          {!collapsed && <span>Recolher</span>}
        </button>
      </div>
    </aside>
  )
}
