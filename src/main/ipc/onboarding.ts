import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { Database } from '../db/database'
import { dismissSteps, finishWelcome, getOnboarding, installSample, removeSample, reopenWelcome } from '../onboarding'

export interface OnboardingIpcOptions {
  db: Database
  userData: string
  /** Pasta com o curso de exemplo (recursos do instalador ou `resources/` em desenvolvimento). */
  sampleSource: string
  /** Curso novo: mede as durações dos vídeos. */
  onImported: (courseId: number) => void
}

export function registerOnboardingIpc({ db, userData, sampleSource, onImported }: OnboardingIpcOptions): void {
  ipcMain.handle(IPC.onboardingGet, () => getOnboarding(db))
  ipcMain.handle(IPC.onboardingFinish, () => finishWelcome(db))
  ipcMain.handle(IPC.onboardingReopen, () => reopenWelcome(db))
  ipcMain.handle(IPC.onboardingDismiss, () => dismissSteps(db))
  ipcMain.handle(IPC.onboardingInstallSample, async () => {
    const info = await installSample(db, sampleSource, userData)
    onImported(info.courseId)
    return info
  })
  ipcMain.handle(IPC.onboardingRemoveSample, () => removeSample(db, userData))
}
