import { Route, Routes } from 'react-router'
import { Sidebar } from './components/Sidebar'
import { HomePage } from './routes/HomePage'
import { CoursesPage } from './routes/CoursesPage'
import { CourseDetailPage } from './routes/CourseDetailPage'
import { SettingsPage } from './routes/SettingsPage'
import { ComingSoonPage } from './routes/ComingSoonPage'

export function App() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/courses" element={<CoursesPage />} />
          <Route path="/courses/:id" element={<CourseDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<ComingSoonPage />} />
        </Routes>
      </main>
    </div>
  )
}
