import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { TaskInput, TaskStatus } from '@shared/planner'
import type { HistoryFilter } from '@shared/progress'
import type { Database } from '../db/database'
import { calendar, createTask, deleteTask, listTasks, moveTask, setTaskDone, tasksForToday, updateTask } from '../db/planner'
import { getProgress, watchHistory } from '../db/progress'

function assertId(id: unknown): number {
  if (!Number.isInteger(id)) throw new Error('Identificador inválido')
  return id as number
}

const optionalId = (id: unknown) => (id === null || id === undefined || id === '' ? null : assertId(id))

function taskInput(input: TaskInput): TaskInput {
  return { ...input, courseId: optionalId(input?.courseId), lessonId: optionalId(input?.lessonId) }
}

export function registerPlannerIpc(db: Database): void {
  ipcMain.handle(IPC.tasksList, () => listTasks(db))
  ipcMain.handle(IPC.tasksCreate, (_e, input: TaskInput) => createTask(db, taskInput(input)))
  ipcMain.handle(IPC.tasksUpdate, (_e, id: number, input: TaskInput) => updateTask(db, assertId(id), taskInput(input)))
  ipcMain.handle(IPC.tasksMove, (_e, id: number, status: TaskStatus, index: number) =>
    moveTask(db, assertId(id), status, Number.isFinite(index) ? index : 0)
  )
  ipcMain.handle(IPC.tasksSetDone, (_e, id: number, done: boolean) => setTaskDone(db, assertId(id), Boolean(done)))
  ipcMain.handle(IPC.tasksDelete, (_e, id: number) => deleteTask(db, assertId(id)))
  ipcMain.handle(IPC.tasksToday, () => tasksForToday(db))
  ipcMain.handle(IPC.calendarRange, (_e, from: string, to: string) => calendar(db, from, to))

  ipcMain.handle(IPC.statsGet, () => getProgress(db))
  ipcMain.handle(IPC.statsHistory, (_e, filter: HistoryFilter) =>
    watchHistory(db, {
      courseId: optionalId(filter?.courseId),
      text: typeof filter?.text === 'string' ? filter.text.slice(0, 200) : '',
      from: filter?.from || null,
      to: filter?.to || null
    })
  )
}
