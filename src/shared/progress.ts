export interface DailyActivity {
  /** 'AAAA-MM-DD' local. */
  date: string
  seconds: number
}

export interface CourseProgress {
  id: number
  title: string
  completed: number
  total: number
}

export interface ProgressData {
  goalMinutes: number
  streak: { current: number; todayDone: boolean; best: number }
  totals: {
    studySeconds: number
    lessonsCompleted: number
    coursesStarted: number
    coursesCompleted: number
    notes: number
    reviews: number
  }
  /** Um registro por dia, do mais antigo a hoje (inclui dias sem estudo). */
  daily: DailyActivity[]
  courses: CourseProgress[]
  flashcards: {
    cards: { new: number; learning: number; review: number }
    reviews30d: number
    /** Fração de revisões (de cartas já graduadas) respondidas sem errar, nos últimos 30 dias. */
    retention30d: number | null
  }
}

export interface HistoryEntry {
  lessonId: number
  title: string
  courseId: number
  courseTitle: string
  moduleTitle: string | null
  lastWatchedAt: number
  positionSec: number
  durationSec: number | null
  completed: boolean
}

export interface HistoryFilter {
  courseId?: number | null
  text?: string
  /** 'AAAA-MM-DD' inclusivos. */
  from?: string | null
  to?: string | null
}
