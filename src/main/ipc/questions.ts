import { writeFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { ExamSelection, ExamSettings } from '@shared/exams'
import { IPC } from '@shared/ipc'
import type { QuestionAnswer, QuestionInput } from '@shared/questions'
import type { Database } from '../db/database'
import {
  bankAnalytics,
  bankTopics,
  createBank,
  createExam,
  createQuestion,
  deleteAttempt,
  deleteBank,
  deleteExam,
  deleteQuestion,
  getAttempt,
  getBank,
  gradeEssay,
  listBanks,
  listExams,
  listQuestions,
  recordFocusLoss,
  saveAnswer,
  setMarked,
  startAttempt,
  submitAttempt,
  updateBank,
  updateQuestion
} from '../db/questions'
import { exportCsv, exportGift, exportJson, importQuestionFile } from '../importers/questions'

function assertId(id: unknown): number {
  if (!Number.isInteger(id)) throw new Error('Identificador inválido')
  return id as number
}

const windowOf = (sender: Electron.WebContents) => BrowserWindow.fromWebContents(sender) ?? undefined

export function registerQuestionIpc(db: Database): void {
  ipcMain.handle(IPC.banksList, () => listBanks(db))
  ipcMain.handle(IPC.banksGet, (_e, id: number) => getBank(db, assertId(id)))
  ipcMain.handle(IPC.banksCreate, (_e, input: { title: string; description?: string }) => createBank(db, { title: input?.title, description: input?.description }))
  ipcMain.handle(IPC.banksUpdate, (_e, id: number, patch: { title: string; description: string }) =>
    updateBank(db, assertId(id), { title: patch?.title, description: patch?.description })
  )
  ipcMain.handle(IPC.banksDelete, (_e, id: number) => deleteBank(db, assertId(id)))
  ipcMain.handle(IPC.banksTopics, (_e, id: number) => bankTopics(db, assertId(id)))
  ipcMain.handle(IPC.banksAnalytics, (_e, id: number) => bankAnalytics(db, assertId(id)))

  ipcMain.handle(IPC.banksImport, async (event, bankId: number | null) => {
    const target = bankId === null || bankId === undefined ? null : assertId(bankId)
    const win = windowOf(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Importar questões',
      properties: ['openFile'],
      filters: [
        { name: 'Questões (JSON, CSV, GIFT)', extensions: ['json', 'csv', 'gift', 'txt'] },
        { name: 'Todos os arquivos', extensions: ['*'] }
      ]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const path = result.canceled ? null : result.filePaths[0]
    return path ? importQuestionFile(db, path, target) : null
  })

  ipcMain.handle(IPC.banksExport, async (event, bankId: number) => {
    const id = assertId(bankId)
    const bank = getBank(db, id)
    const win = windowOf(event.sender)
    const options: Electron.SaveDialogOptions = {
      title: 'Exportar questões',
      defaultPath: `${bank.title.replace(/[\\/:*?"<>|]/g, '_')}.json`,
      filters: [
        { name: 'Tramotak (JSON, sem perdas)', extensions: ['json'] },
        { name: 'Planilha (CSV)', extensions: ['csv'] },
        { name: 'Moodle (GIFT)', extensions: ['gift'] }
      ]
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    const ext = extname(result.filePath).toLowerCase()
    const content = ext === '.csv' ? exportCsv(db, id) : ext === '.gift' || ext === '.txt' ? exportGift(db, id) : exportJson(db, id)
    await writeFile(result.filePath, content, 'utf8')
    return result.filePath
  })

  ipcMain.handle(IPC.questionsList, (_e, bankId: number) => listQuestions(db, assertId(bankId)))
  ipcMain.handle(IPC.questionsCreate, (_e, bankId: number, input: QuestionInput) => createQuestion(db, assertId(bankId), input))
  ipcMain.handle(IPC.questionsUpdate, (_e, id: number, input: QuestionInput) => updateQuestion(db, assertId(id), input))
  ipcMain.handle(IPC.questionsDelete, (_e, id: number) => deleteQuestion(db, assertId(id)))

  ipcMain.handle(IPC.examsList, (_e, bankId: number) => listExams(db, assertId(bankId)))
  ipcMain.handle(IPC.examsCreate, (_e, bankId: number, input: { title: string; settings?: Partial<ExamSettings>; selection: ExamSelection }) =>
    createExam(db, assertId(bankId), { title: input?.title, settings: input?.settings, selection: input?.selection })
  )
  ipcMain.handle(IPC.examsDelete, (_e, id: number) => deleteExam(db, assertId(id)))

  ipcMain.handle(IPC.attemptsStart, (_e, examId: number) => startAttempt(db, assertId(examId)))
  ipcMain.handle(IPC.attemptsGet, (_e, id: number) => getAttempt(db, assertId(id)))
  ipcMain.handle(IPC.attemptsAnswer, (_e, id: number, questionId: number, answer: QuestionAnswer | null) =>
    saveAnswer(db, assertId(id), assertId(questionId), answer ?? null)
  )
  ipcMain.handle(IPC.attemptsMark, (_e, id: number, questionId: number, marked: boolean) => setMarked(db, assertId(id), assertId(questionId), Boolean(marked)))
  ipcMain.handle(IPC.attemptsFocusLoss, (_e, id: number) => recordFocusLoss(db, assertId(id)))
  ipcMain.handle(IPC.attemptsSubmit, (_e, id: number) => submitAttempt(db, assertId(id)))
  ipcMain.handle(IPC.attemptsGradeEssay, (_e, id: number, questionId: number, correct: boolean) =>
    gradeEssay(db, assertId(id), assertId(questionId), Boolean(correct))
  )
  ipcMain.handle(IPC.attemptsDelete, (_e, id: number) => deleteAttempt(db, assertId(id)))
}
