import { useCallback, useEffect, useMemo, useState } from 'react'
import { Route, Routes, useNavigate } from 'react-router'
import { Sidebar } from './components/Sidebar'
import { HomePage } from './routes/HomePage'
import { CoursesPage } from './routes/CoursesPage'
import { CourseDetailPage } from './routes/CourseDetailPage'
import { PlayerPage } from './routes/PlayerPage'
import { SettingsPage } from './routes/SettingsPage'
import { ComingSoonPage } from './routes/ComingSoonPage'
import { SearchPalette } from './components/SearchPalette'
import { FlashcardsPage } from './routes/FlashcardsPage'
import { DeckPage } from './routes/DeckPage'
import { StudyPage } from './routes/StudyPage'
import { PlannerPage } from './routes/PlannerPage'
import { ProgressPage } from './routes/ProgressPage'
import { SearchContext } from './lib/searchContext'

export function App() {
  const [searchOpen, setSearchOpen] = useState(false)
  const openSearch = useCallback(() => setSearchOpen(true), [])
  const search = useMemo(() => ({ open: openSearch }), [openSearch])
  const navigate = useNavigate()

  // Clique numa notificação do sistema abre a tela pedida pelo processo principal.
  useEffect(() => window.api.app.onNavigate((path) => navigate(path)), [navigate])

  // Ctrl+K (Cmd+K no macOS) abre a busca de qualquer tela, até de dentro de campos de texto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <SearchContext.Provider value={search}>
      <div className="flex h-full">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/courses" element={<CoursesPage />} />
            <Route path="/courses/:id" element={<CourseDetailPage />} />
            <Route path="/lesson/:id" element={<PlayerPage />} />
            <Route path="/flashcards" element={<FlashcardsPage />} />
            <Route path="/flashcards/:id" element={<DeckPage />} />
            <Route path="/flashcards/:id/study" element={<StudyPage />} />
            <Route path="/planner" element={<PlannerPage />} />
            <Route path="/progress" element={<ProgressPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<ComingSoonPage />} />
          </Routes>
        </main>
        <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      </div>
    </SearchContext.Provider>
  )
}
