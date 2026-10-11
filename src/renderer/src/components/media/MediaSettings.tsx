import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Trash2 } from 'lucide-react'
import type { AppSettings } from '@shared/ipc'
import { formatBytes, plural } from '@shared/format'
import { errorMessage, queryKeys } from '../../lib/api'
import { Button } from '../Button'
import { Label, Segmented, TextInput } from '../Field'
import { useToast } from '../Toast'

const MODELS = [
  { value: 'whisper-large-v3-turbo', label: 'whisper-large-v3-turbo (rápido)' },
  { value: 'whisper-large-v3', label: 'whisper-large-v3 (mais preciso)' }
]

export function MediaSettings({ settings }: { settings: AppSettings }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [key, setKey] = useState('')
  const [args, setArgs] = useState(settings.conversionArgs)
  const [url, setUrl] = useState(settings.localWhisperUrl)
  const [model, setModel] = useState(settings.transcriptionModel)
  const [language, setLanguage] = useState(settings.transcriptionLanguage)
  const hasKey = useQuery({ queryKey: ['groq-key'], queryFn: () => window.api.secrets.hasGroqKey() })
  const storage = useQuery({ queryKey: ['conversion-storage'], queryFn: () => window.api.media.storage(false), staleTime: 0 })

  const save = useMutation({
    mutationFn: (patch: Partial<AppSettings>) => window.api.settings.update(patch),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.settings })
      toast('Configuração salva')
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const saveKey = useMutation({
    mutationFn: (value: string | null) => window.api.secrets.setGroqKey(value),
    onSuccess: async () => {
      setKey('')
      await queryClient.invalidateQueries({ queryKey: ['groq-key'] })
      toast('Chave atualizada')
    },
    onError: (error) => toast(errorMessage(error), 'error')
  })
  const clean = useMutation({
    mutationFn: () => window.api.media.storage(true),
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: ['conversion-storage'] })
      toast(r.removed ? `${plural(r.removed, 'cópia removida', 'cópias removidas')}` : 'Nada para limpar')
    }
  })

  const provider = settings.transcriptionProvider

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-medium">Conversão de vídeos</p>
        <p className="text-xs text-muted">
          Vídeos que o player não toca (ex.: HEVC/H.265, AVI) podem ser convertidos pelo FFmpeg embutido. As cópias ficam na pasta de dados do app; os
          arquivos dos cursos nunca são alterados.
        </p>
        <Label htmlFor="conv-args">Parâmetros da conversão completa</Label>
        <div className="flex gap-2">
          <TextInput id="conv-args" value={args} onChange={(e) => setArgs(e.target.value)} className="font-mono text-xs" />
          <Button variant="ghost" onClick={() => save.mutate({ conversionArgs: args })} disabled={args === settings.conversionArgs}>
            Salvar
          </Button>
        </div>
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{storage.data ? `${plural(storage.data.files, 'cópia convertida', 'cópias convertidas')} · ${formatBytes(storage.data.bytes)}` : '…'}</span>
          <button type="button" onClick={() => clean.mutate()} className="inline-flex items-center gap-1 hover:text-text">
            <Trash2 size={12} /> Apagar cópias sem uso
          </button>
        </div>
      </div>

      <div className="space-y-3 border-t border-border pt-5">
        <p className="text-sm font-medium">Transcrição das aulas</p>
        <Segmented
          label="Provedor de transcrição"
          value={provider}
          onChange={(v) => save.mutate({ transcriptionProvider: v })}
          options={[
            { value: 'none', label: 'Desligada' },
            { value: 'groq', label: 'Groq (nuvem)' },
            { value: 'local', label: 'Whisper local' }
          ]}
        />
        {provider === 'groq' && (
          <div className="space-y-2">
            <p className="text-xs text-muted">O áudio de cada aula é enviado ao Groq para transcrever. A chave fica cifrada pelo cofre do sistema e não sai deste computador.</p>
            {hasKey.data ? (
              <div className="flex items-center gap-2 text-sm">
                <KeyRound size={14} className="text-success" /> Chave salva
                <Button variant="ghost" className="ml-auto h-8" onClick={() => saveKey.mutate(null)}>
                  Remover
                </Button>
              </div>
            ) : (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (key.trim()) saveKey.mutate(key)
                }}
              >
                <TextInput type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="gsk_…" aria-label="Chave de API do Groq" autoComplete="off" />
                <Button type="submit" disabled={!key.trim() || saveKey.isPending}>
                  Salvar chave
                </Button>
              </form>
            )}
          </div>
        )}
        {provider === 'local' && (
          <div className="space-y-2">
            <p className="text-xs text-muted">Qualquer servidor compatível com a API da OpenAI (ex.: faster-whisper, speaches, LocalAI). O áudio não sai da sua rede.</p>
            <Label htmlFor="whisper-url">Endereço do servidor</Label>
            <div className="flex gap-2">
              <TextInput id="whisper-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:8000/v1" />
              <Button variant="ghost" onClick={() => save.mutate({ localWhisperUrl: url })} disabled={url === settings.localWhisperUrl}>
                Salvar
              </Button>
            </div>
          </div>
        )}
        {provider !== 'none' && (
          <div className="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
            <div>
              <Label htmlFor="stt-model">Modelo</Label>
              {provider === 'groq' ? (
                <select id="stt-model" value={model} onChange={(e) => setModel(e.target.value)} className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-text">
                  {MODELS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              ) : (
                <TextInput id="stt-model" value={model} onChange={(e) => setModel(e.target.value)} />
              )}
            </div>
            <div>
              <Label htmlFor="stt-lang">Idioma</Label>
              <TextInput id="stt-lang" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="auto" />
            </div>
            <Button variant="ghost" onClick={() => save.mutate({ transcriptionModel: model, transcriptionLanguage: language })} disabled={model === settings.transcriptionModel && language === settings.transcriptionLanguage}>
              Salvar
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
