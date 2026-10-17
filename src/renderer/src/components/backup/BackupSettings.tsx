import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CloudUpload, DatabaseBackup, FolderInput, FolderOpen, History, Loader2, RotateCcw } from 'lucide-react'
import type { AppSettings } from '@shared/ipc'
import type { BackupEntry, BackupInfo, BackupPlace } from '@shared/backup'
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

type RestoreTarget = { info: BackupInfo; name: string | null; place: BackupPlace }

/** Confirmação de restauração: mostra o conteúdo do backup e avisa que o app reinicia. */
function RestoreDialog({ target, onClose }: { target: RestoreTarget | null; onClose: () => void }) {
  const toast = useToast()
  const restore = useMutation({
    mutationFn: () => window.api.backup.restore(target!.name, target!.place),
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const manualReopen = restore.data?.relaunch === false
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
          <Button variant="danger" onClick={() => restore.mutate()} disabled={restore.isPending || restore.isSuccess}>
            {restore.isPending || restore.isSuccess ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />} Restaurar e reiniciar
          </Button>
        </>
      }
    >
      {target && manualReopen ? (
        <p className="text-sm">
          <b>Backup pronto para restaurar.</b> O Tramotak vai fechar em instantes; <b>abra o app de novo</b> para concluir a restauração.
        </p>
      ) : target && (
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

function BackupList({ backups, busy, onRestore }: { backups: BackupEntry[]; busy: boolean; onRestore: (name: string) => void }) {
  return (
    <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
      {backups.map((b) => (
        <li key={b.name} className="flex items-center gap-3 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            <span className="block truncate">{dateTime(b.modifiedAt)}</span>
            <span className="text-xs text-muted">
              {KIND_LABEL[b.kind]} · {formatBytes(b.bytes)}
            </span>
          </span>
          <Button variant="ghost" className="h-8" onClick={() => onRestore(b.name)} disabled={busy}>
            Restaurar
          </Button>
        </li>
      ))}
    </ul>
  )
}

export function BackupSettings({ settings }: { settings: AppSettings }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [restoring, setRestoring] = useState<RestoreTarget | null>(null)
  const list = useQuery({ queryKey: ['backups'], queryFn: () => window.api.backup.list(), staleTime: 0 })

  const create = useMutation({
    mutationFn: () => window.api.backup.create(),
    onSuccess: (r) => r && toast(`Backup salvo (${formatBytes(r.bytes)})`),
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const pickFile = useMutation({
    mutationFn: () => window.api.backup.inspectFile(),
    onSuccess: (info) => info && setRestoring({ info, name: null, place: 'app' }),
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const pickListed = useMutation({
    mutationFn: ({ name, place }: { name: string; place: BackupPlace }) => window.api.backup.inspect(name, place).then((info) => ({ info, name, place })),
    onSuccess: setRestoring,
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['backups'] })
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
  }
  const folderStatus = (s: { error: string | null } | null) => {
    if (!s) return
    if (s.error) toast(`Não foi possível gravar na pasta: ${s.error}`, 'error')
    else toast('Backup gravado na pasta')
  }
  const chooseFolder = useMutation({
    mutationFn: () => window.api.backup.chooseFolder(),
    onSuccess: folderStatus,
    onError: (error) => toast(errorMessage(error), 'error'),
    onSettled: refresh
  })
  const folderNow = useMutation({
    mutationFn: () => window.api.backup.folderNow(),
    onSuccess: folderStatus,
    onError: (error) => toast(errorMessage(error), 'error'),
    onSettled: refresh
  })
  const clearFolder = useMutation({
    mutationFn: () => window.api.backup.clearFolder(),
    onError: (error) => toast(errorMessage(error), 'error'),
    onSettled: refresh
  })
  const folder = list.data?.folder
  const folderBusy = chooseFolder.isPending || folderNow.isPending || clearFolder.isPending
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
          <BackupList backups={backups} busy={pickListed.isPending} onRestore={(name) => pickListed.mutate({ name, place: 'app' })} />
        )}
      </div>

      <div className="space-y-3 rounded-lg border border-border p-4" aria-label="Pasta de backup">
        <div>
          <p className="inline-flex items-center gap-1.5 text-sm font-medium">
            <CloudUpload size={16} /> Cópia numa pasta sua
          </p>
          <p className="mt-1 text-xs text-muted">
            Escolha uma pasta do Google Drive, Dropbox, OneDrive ou de um pendrive. O Tramotak grava nela um backup por dia e outro ao fechar (se algo mudou), guardando os 7
            mais recentes. Em outro computador, escolha a mesma pasta e restaure por aqui.
          </p>
        </div>
        {!folder?.path ? (
          <Button variant="ghost" onClick={() => chooseFolder.mutate()} disabled={folderBusy}>
            {chooseFolder.isPending ? <Loader2 size={16} className="animate-spin" /> : <FolderInput size={16} />} Escolher pasta…
          </Button>
        ) : (
          <>
            <p className="truncate rounded-md bg-bg/50 px-2 py-1 font-mono text-xs" title={folder.path}>
              {folder.path}
            </p>
            {folder.error ? (
              <p role="alert" className="flex items-start gap-1.5 text-xs text-red-400">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  Última tentativa falhou{folder.errorAt ? ` (${dateTime(folder.errorAt)})` : ''}: {folder.error}
                  {/[.?!)]$/.test(folder.error) ? ' ' : '. '}
                  {folder.lastAt ? `Último backup gravado em ${dateTime(folder.lastAt)}.` : 'Nenhum backup gravado ainda.'} O app tenta de novo a cada hora.
                </span>
              </p>
            ) : (
              <p className="text-xs text-muted">{folder.lastAt ? `Último backup: ${dateTime(folder.lastAt)}` : 'Nenhum backup gravado ainda.'}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" className="h-8" onClick={() => folderNow.mutate()} disabled={folderBusy}>
                {folderNow.isPending ? <Loader2 size={14} className="animate-spin" /> : <CloudUpload size={14} />} Gravar agora
              </Button>
              <Button variant="ghost" className="h-8" onClick={() => chooseFolder.mutate()} disabled={folderBusy}>
                <FolderInput size={14} /> Trocar pasta…
              </Button>
              <Button variant="ghost" className="h-8" onClick={() => clearFolder.mutate()} disabled={folderBusy}>
                Parar de usar
              </Button>
            </div>
            {folder.listError ? (
              // Com a última tentativa já falhando, o motivo aparece acima; não repete.
              !folder.error && <p className="text-xs text-muted">Não foi possível ler a pasta agora: {folder.listError}</p>
            ) : folder.backups.length > 0 ? (
              <BackupList backups={folder.backups} busy={pickListed.isPending} onRestore={(name) => pickListed.mutate({ name, place: 'folder' })} />
            ) : null}
          </>
        )}
      </div>

      <RestoreDialog target={restoring} onClose={() => setRestoring(null)} />
    </div>
  )
}
