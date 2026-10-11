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
import { TopBar } from './components/TopBar'
import { FlashcardsPage } from './routes/FlashcardsPage'
import { DeckPage } from './routes/DeckPage'
import { StudyPage } from './routes/StudyPage'
import { PlannerPage } from './routes/PlannerPage'
import { ProgressPage } from './routes/ProgressPage'
import { QuestionsPage } from './routes/QuestionsPage'
import { BankPage } from './routes/BankPage'
import { AttemptPage } from './routes/AttemptPage'
import { NotebooksPage } from './routes/NotebooksPage'
import { NotebookPage } from './routes/NotebookPage'
import { MindmapsPage } from './routes/MindmapsPage'
import { MindmapPage } from './routes/MindmapPage'
import { AiPage } from './routes/AiPage'
import { SearchContext } from './lib/searchContext'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from './lib/api'

export function App() {
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchInitial, setSearchInitial] = useState('')
  const openSearch = useCallback((initial = '') => {
    setSearchInitial(initial)
    setSearchOpen(true)
  }, [])
  const search = useMemo(() => ({ open: openSearch }), [openSearch])
  const navigate = useNavigate()

  // Durações medidas em segundo plano: atualiza listas e detalhes de cursos aos poucos.
  const queryClient = useQueryClient()
  useEffect(
    () =>
      window.api.courses.onDurations((u) => {
        if (u.filled > 0 || u.done) void queryClient.invalidateQueries({ queryKey: queryKeys.courses })
      }),
    [queryClient]
  )

  // Clique numa notificação do sistema abre a tela pedida pelo processo principal.
  useEffect(() => window.api.app.onNavigate((path) => navigate(path)), [navigate])

  // Ctrl+K (Cmd+K no macOS) abre a busca de qualquer tela, até de dentro de campos de texto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        openSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openSearch])

  return (
    <SearchContext.Provider value={search}>
      <div className="flex h-full">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="min-h-0 flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/courses" element={<CoursesPage />} />
            <Route path="/courses/:id" element={<CourseDetailPage />} />
            <Route path="/lesson/:id" element={<PlayerPage />} />
            <Route path="/flashcards" element={<FlashcardsPage />} />
            <Route path="/flashcards/:id" element={<DeckPage />} />
            <Route path="/flashcards/:id/study" element={<StudyPage />} />
            <Route path="/questions" element={<QuestionsPage />} />
            <Route path="/questions/:id" element={<BankPage />} />
            <Route path="/questions/attempt/:id" element={<AttemptPage />} />
            <Route path="/notebooks" element={<NotebooksPage />} />
            <Route path="/notebooks/:id" element={<NotebookPage />} />
            <Route path="/mindmaps" element={<MindmapsPage />} />
            <Route path="/mindmaps/:id" element={<MindmapPage />} />
            <Route path="/planner" element={<PlannerPage />} />
            <Route path="/progress" element={<ProgressPage />} />
            <Route path="/ai" element={<AiPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<ComingSoonPage />} />
          </Routes>
          </main>
        </div>
        <SearchPalette open={searchOpen} initial={searchInitial} onClose={() => setSearchOpen(false)} />
      </div>
    </SearchContext.Provider>
  )
}
