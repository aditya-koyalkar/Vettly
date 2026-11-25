import { AlertCircle, CheckCircle2, FileUp, Loader2, Upload } from 'lucide-react'
import { useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { formatDate } from '@/lib/format'
import { useDocuments, useUploadDocument } from '@/lib/queries'
import type { DocumentKind, VettlyDocument } from '@/lib/types'
import { cn } from '@/lib/utils'

const ACCEPT = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'text/plain': ['.txt'],
  'text/markdown': ['.md'],
}

const COPY: Record<DocumentKind, { noun: string; pastePlaceholder: string }> = {
  RESUME: { noun: 'resume', pastePlaceholder: 'Paste your resume text…' },
  JOB_DESCRIPTION: { noun: 'job description', pastePlaceholder: 'Paste the full job description, including requirements…' },
}

export function DocumentStatusIcon({ doc }: { doc: VettlyDocument }) {
  if (doc.status === 'PROCESSING') return <Loader2 className="size-4 animate-spin text-primary" aria-label="Analysing" />
  if (doc.status === 'FAILED') return <AlertCircle className="size-4 text-destructive" aria-label="Failed" />
  return <CheckCircle2 className="size-4 text-success" aria-label="Ready" />
}

/** Upload, paste, or reuse a previously analysed document. */
export function DocumentPicker({
  kind,
  selectedId,
  onSelect,
}: {
  kind: DocumentKind
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const { data: docs = [] } = useDocuments(kind)
  const upload = useUploadDocument()
  const [text, setText] = useState('')
  const usable = docs.filter((d) => d.status !== 'FAILED')
  const [tab, setTab] = useState<string>(() => (usable.length ? 'library' : 'upload'))
  const copy = COPY[kind]

  async function submit(input: { file?: File; text?: string }) {
    try {
      const doc = await upload.mutateAsync({ kind, ...input })
      onSelect(doc.id)
      setText('')
      setTab('library')
      toast.success(`Got it. Analysing your ${copy.noun}.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  const dropzone = useDropzone({
    accept: ACCEPT,
    maxFiles: 1,
    maxSize: 5 * 1024 * 1024,
    disabled: upload.isPending,
    onDropAccepted: ([file]) => submit({ file }),
    onDropRejected: ([rejection]) => toast.error(rejection?.errors[0]?.message ?? 'File not supported'),
  })

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
      <TabsList>
        <TabsTrigger value="upload">Upload</TabsTrigger>
        <TabsTrigger value="paste">Paste text</TabsTrigger>
        <TabsTrigger value="library" disabled={!usable.length}>
          Saved ({usable.length})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="upload" className="mt-4">
        <div
          {...dropzone.getRootProps()}
          className={cn(
            'grid cursor-pointer place-items-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors',
            dropzone.isDragActive ? 'border-primary bg-primary/5' : 'hover:border-primary/50 hover:bg-muted/40',
          )}
        >
          <input {...dropzone.getInputProps()} />
          {upload.isPending ? (
            <Loader2 className="size-6 animate-spin text-primary" />
          ) : (
            <FileUp className="size-6 text-muted-foreground" aria-hidden />
          )}
          <p className="mt-3 text-sm font-medium">
            {dropzone.isDragActive ? 'Drop it here' : `Drop your ${copy.noun} or click to browse`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">PDF, DOCX, TXT or Markdown, up to 5 MB</p>
        </div>
      </TabsContent>

      <TabsContent value="paste" className="mt-4 space-y-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={copy.pastePlaceholder}
          className="min-h-48"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{text.trim().length} characters (min 50)</span>
          <Button size="sm" disabled={text.trim().length < 50 || upload.isPending} onClick={() => submit({ text })}>
            {upload.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Use this text
          </Button>
        </div>
      </TabsContent>

      <TabsContent value="library" className="mt-4">
        <ul className="grid gap-2" role="radiogroup" aria-label={`Saved ${copy.noun}s`}>
          {usable.map((doc) => (
            <li key={doc.id}>
              <button
                type="button"
                role="radio"
                aria-checked={selectedId === doc.id}
                onClick={() => onSelect(doc.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/50',
                  selectedId === doc.id && 'border-primary ring-2 ring-primary/20',
                )}
              >
                <DocumentStatusIcon doc={doc} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{doc.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {doc.status === 'PROCESSING' ? 'Analysing…' : `Added ${formatDate(doc.createdAt)}`}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </TabsContent>
    </Tabs>
  )
}
