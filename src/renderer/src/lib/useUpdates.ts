import { useEffect, useState } from 'react'
import type { UpdateInfo } from '@shared/updates'

/** Estado das atualizações, acompanhando as mudanças vindas do processo principal. */
export function useUpdates(): UpdateInfo | null {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  useEffect(() => {
    let alive = true
    void window.api.updates.info().then((i) => alive && setInfo(i))
    const off = window.api.updates.onState(setInfo)
    return () => {
      alive = false
      off()
    }
  }, [])
  return info
}
