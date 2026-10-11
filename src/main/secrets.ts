import { safeStorage } from 'electron'
import type { Database } from './db/database'
import { getInternal, setInternal } from './db/settings'

/**
 * Segredos (chaves de API) cifrados pelo cofre do sistema operacional e guardados no banco.
 * Nunca voltam para a interface: ela só sabe se existe uma chave salva.
 */
export function setSecret(db: Database, name: string, value: string | null): void {
  if (value === null || value.trim() === '') {
    setInternal(db, `secret.${name}`, null)
    return
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('O cofre de senhas do sistema não está disponível; não é possível guardar a chave com segurança.')
  }
  setInternal(db, `secret.${name}`, safeStorage.encryptString(value.trim()).toString('base64'))
}

export function getSecret(db: Database, name: string): string | null {
  const stored = getInternal(db, `secret.${name}`)
  if (typeof stored !== 'string' || !stored) return null
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return null
  }
}

export function hasSecret(db: Database, name: string): boolean {
  return typeof getInternal(db, `secret.${name}`) === 'string'
}
