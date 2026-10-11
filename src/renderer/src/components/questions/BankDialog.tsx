import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { BankSummary } from '@shared/exams'
import { errorMessage } from '../../lib/api'
import { Modal } from '../Modal'
import { Button } from '../Button'
import { Label, TextArea, TextInput } from '../Field'
import { useToast } from '../Toast'

export function BankDialog({ open, bank, onClose, onSaved }: { open: boolean; bank: BankSummary | null; onClose: () => void; onSaved?: (id: number) => void }) {
  return (
    <Modal open={open} onClose={onClose} title={bank ? 'Editar banco' : 'Novo banco de questões'}>
      {open && <BankForm key={bank?.id ?? 'novo'} bank={bank} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  )
}

function BankForm({ bank, onClose, onSaved }: { bank: BankSummary | null; onClose: () => void; onSaved?: (id: number) => void }) {
  const [title, setTitle] = useState(bank?.title ?? '')
  const [description, setDescription] = useState(bank?.description ?? '')
  const queryClient = useQueryClient()
  const toast = useToast()
  const save = useMutation({
    mutationFn: async () => {
      if (bank) {
        await window.api.banks.update(bank.id, { title, description })
        return bank.id
      }
      return window.api.banks.create({ title, description })
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ['banks'] })
      onClose()
      onSaved?.(id)
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <div>
        <Label htmlFor="bank-title">Nome</Label>
        <TextInput id="bank-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Cálculo I — provas antigas" data-autofocus />
      </div>
      <div>
        <Label htmlFor="bank-description">Descrição</Label>
        <TextArea id="bank-description" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!title.trim() || save.isPending}>
          {bank ? 'Salvar' : 'Criar'}
        </Button>
      </div>
    </form>
  )
}
