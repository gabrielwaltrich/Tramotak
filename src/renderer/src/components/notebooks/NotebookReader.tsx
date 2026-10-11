import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { TextBlock } from './TextBlock'
import { InkBlock } from './InkBlock'
import { ResourceBlock } from './ResourceBlock'

/** Leitura contínua: todas as páginas em sequência, só leitura. */
export function NotebookReader({ notebookId }: { notebookId: number }) {
  const pages = useQuery({ queryKey: ['notebook', notebookId, 'pages'], queryFn: () => window.api.notebooks.pages(notebookId), staleTime: 0 })
  if (pages.isPending) return <Loader2 className="mx-auto my-16 animate-spin text-muted" />
  return (
    <div className="space-y-12">
      {pages.data?.map((p) => (
        <article key={p.id} id={`page-${p.id}`}>
          <h2 className="mb-4 border-b border-border pb-2 text-2xl font-semibold tracking-tight">{p.title}</h2>
          <div className="space-y-3">
            {p.blocks.map((b) =>
              b.type === 'text' ? (
                <TextBlock key={b.id} text={b.text} editing={false} onEdit={() => {}} onChange={() => {}} onDone={() => {}} readOnly />
              ) : b.type === 'ink' ? (
                <InkBlock key={b.id} strokes={b.strokes} height={b.height} onChange={() => {}} readOnly />
              ) : (
                <ResourceBlock key={b.id} resource={b.resource} />
              )
            )}
          </div>
        </article>
      ))}
    </div>
  )
}
