/** localStorage tolerante a falhas: só para preferências de interface. */
export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // preferência não persistida; segue com o valor em memória
  }
}
