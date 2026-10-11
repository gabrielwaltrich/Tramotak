import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DatabaseBackup, FolderOpen, History, Loader2, RotateCcw } from 'lucide-react'
import type { AppSettings } from '@shared/ipc'
import type { BackupEntry, BackupInfo } from '@shared/backup'
import { formatBytes, plural } from '@shared/format'
import { errorMessage, queryKeys } from '../../lib/api'
import { Button } from '../Button'
import { Modal } from '../Modal'
import { useToast } from '../Toast'

const KIND_LABEL: Record<BackupEntry['kind'], string> = { auto: 'Automático', 'pre-restore': 'Antes de restaurar', manual: 'Manual' }

const dateTime = (sec: number) => new Date(sec * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

function Contents({ info }: { info: BackupInfo }) {
  const c = info.counts
  const items = [
    plural(c.courses, 'curso'),
    plural(c.lessons, 'aula'),
    plural(c.notes, 'anotação', 'anotações'),
    plural(c.cards, 'carta'),
    plural(c.questions, 'questão', 'questões'),
    plural(c.pages, 'página'),
    plural(c.mindmaps, 'mapa mental', 'mapas mentais')
  ]
  return <p className="rounded-lg border border-border bg-bg/50 p-3 text-xs text-text">{items.join(' · ')}</p>
}

/** Confirmação de restauração: mostra o conteúdo do backup e avisa que o app reinicia. */
function RestoreDialog({ target, onClose }: { target: { info: BackupInfo; name: string | null } | null; onClose: () => void }) {
  const toast = useToast()
  const restore = useMutation({
    mutationFn: () => window.api.backup.restore(target!.name),
    onError: (error) => toast(errorMessage(error), 'error')
  })
  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title="Restaurar backup"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={restore.isPending} data-autofocus>
            Cancelar
          </Button>
          <Button variant="danger" onClick={() => restore.mutate()} disabled={restore.isPending}>
            {restore.isPending ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />} Restaurar e reiniciar
          </Button>
        </>
      }
    >
      {target && (
        <div className="space-y-3 text-sm">
          <p>
            <b>{target.info.name}</b> <span className="text-muted">· {dateTime(target.info.modifiedAt)} · {formatBytes(target.info.bytes)}</span>
          </p>
          <Contents info={target.info} />
          <p className="text-muted">
            Tudo o que está no app agora será substituído pelo conteúdo deste backup, e o Tramotak vai reiniciar. O estado atual fica guardado antes, em “Antes de restaurar”, para
            você voltar se precisar. As chaves de API deste computador são mantidas.
          </p>
        </div>
      )}
    </Modal>
  )
}

export function BackupSettings({ settings }: { settings: AppSettings }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [restoring, setRestoring] = useState<{ info: BackupInfo; name: string | null } | null>(null)
  const list = useQuery({ queryKey: ['backups'], queryFn: () => window.api.backup.list(), staleTime: 0 })

  const create = useMutation({
    mutationFn: () => window.api.backup.create(),
    onSuccess: (r) => r && toast(`Backup salvo (${formatBytes(r.bytes)})`),
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const pickFile = useMutation({
    mutationFn: () => window.api.backup.inspectFile(),
    onSuccess: (info) => info && setRestoring({ info, name: null }),
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const pickListed = useMutation({
    mutationFn: (name: string) => window.api.backup.inspect(name).then((info) => ({ info, name })),
    onSuccess: setRestoring,
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const toggleAuto = useMutation({
    mutationFn: (value: boolean) => window.api.settings.update({ autoBackup: value }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const backups = list.data?.backups ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending ? <Loader2 size={16} className="animate-spin" /> : <DatabaseBackup size={16} />} Fazer backup agora
        </Button>
        <Button variant="ghost" onClick={() => pickFile.mutate()} disabled={pickFile.isPending}>
          <RotateCcw size={16} /> Restaurar de um arquivo…
        </Button>
      </div>
      <p className="text-xs text-muted">
        O backup guarda cursos, progresso, anotações, transcrições, flashcards, questões, cadernos, mapas, tarefas e configurações num único arquivo. Os vídeos não entram (continuam nas pastas dos
        cursos) nem as chaves de API. Para levar para outro computador, restaure lá e use “Trocar pasta…” nos cursos que estiverem em outro lugar.
      </p>

      <label className="flex cursor-pointer items-center gap-3 text-sm">
        <input type="checkbox" checked={settings.autoBackup} onChange={(e) => toggleAuto.mutate(e.target.checked)} className="size-4 accent-[var(--accent)]" />
        Backup automático diário (guarda os 7 mais recentes)
      </label>

      <div>
        <div className="mb-2 flex items-center justify-between text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <History size={14} /> Backups nesta pasta do app
          </span>
          <button type="button" onClick={() => window.api.backup.openFolder().catch((e) => toast(errorMessage(e), 'error'))} className="inline-flex items-center gap-1 hover:text-text">
            <FolderOpen size={12} /> Abrir pasta
          </button>
        </div>
        {backups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted">Nenhum backup ainda. O automático roda um minuto depois de abrir o app.</p>
        ) : (
          <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {backups.map((b) => (
              <li key={b.name} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{dateTime(b.modifiedAt)}</span>
                  <span className="text-xs text-muted">
                    {KIND_LABEL[b.kind]} · {formatBytes(b.bytes)}
                  </span>
                </span>
                <Button variant="ghost" className="h-8" onClick={() => pickListed.mutate(b.name)} disabled={pickListed.isPending}>
                  Restaurar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <RestoreDialog target={restoring} onClose={() => setRestoring(null)} />
    </div>
  )
}
