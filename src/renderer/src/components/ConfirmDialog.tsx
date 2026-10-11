import type { ReactNode } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'

export function ConfirmDialog({ open, title, children, confirmLabel, onConfirm, onClose, busy = false }: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
  busy?: boolean
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy} data-autofocus>
            Cancelar
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-muted">{children}</div>
    </Modal>
  )
}
