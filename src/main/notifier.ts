import { BrowserWindow, Notification } from 'electron'
import { IPC } from '@shared/ipc'
import { plural } from '@shared/format'
import { dayKey } from '@shared/streak'
import type { Database } from './db/database'
import { dueToday } from './db/flashcards'
import { takeBlockReminders, tasksForToday } from './db/planner'
import { getInternal, getSettings, setInternal } from './db/settings'

const CHECK_EVERY_MS = 30_000
/** O resumo do dia sai a partir deste horário local. */
const SUMMARY_HOUR = 8

function openPlanner(getWindow: () => BrowserWindow | undefined) {
  const win = getWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.send(IPC.navigate, '/planner')
}

function show(title: string, body: string, getWindow: () => BrowserWindow | undefined) {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, silent: false })
  n.on('click', () => openPlanner(getWindow))
  n.show()
}

/** Confere periodicamente blocos que vão começar e manda um resumo por dia. */
export function startNotifier(db: Database, getWindow: () => BrowserWindow | undefined): () => void {
  const tick = () => {
    try {
      const settings = getSettings(db)
      if (!settings.notificationsEnabled) return
      const now = new Date()

      for (const task of takeBlockReminders(db, now, settings.notifyLeadMinutes)) {
        const when = settings.notifyLeadMinutes === 0 ? 'agora' : `às ${task.scheduledTime}`
        show(`Bloco de estudo ${when}`, [task.title, task.lessonTitle ?? task.courseTitle].filter(Boolean).join(' · '), getWindow)
      }

      const today = dayKey(now)
      if (now.getHours() >= SUMMARY_HOUR && getInternal(db, 'lastSummaryDate') !== today) {
        setInternal(db, 'lastSummaryDate', today)
        const tasks = tasksForToday(db, now).length
        const cards = dueToday(db, Math.floor(now.getTime() / 1000))
        if (tasks + cards > 0) {
          const parts = [tasks > 0 && plural(tasks, 'tarefa'), cards > 0 && plural(cards, 'flashcard')].filter(Boolean)
          show('Seu dia de estudos', `Para hoje: ${parts.join(' e ')}.`, getWindow)
        }
      }
    } catch (error) {
      console.error('Falha ao verificar notificações', error)
    }
  }
  tick()
  const timer = setInterval(tick, CHECK_EVERY_MS)
  return () => clearInterval(timer)
}
