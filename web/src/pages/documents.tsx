import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/app-shell'
import { DocumentPicker, DocumentStatusIcon } from '@/components/document-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDate } from '@/lib/format'
import { useDeleteDocument, useDocuments } from '@/lib/queries'
import type { DocumentKind, JobProfile, ResumeProfile, VettlyDocument } from '@/lib/types'

export function DocumentsPage() {
  const [kind, setKind] = useState<DocumentKind>('RESUME')

  return (
    <>
      <PageHeader
        title="Documents"
        description="Resumes and job descriptions are chunked, embedded and analysed once, then reused across interviews."
      />
      <Tabs value={kind} onValueChange={(v) => setKind(v as DocumentKind)}>
        <TabsList>
          <TabsTrigger value="RESUME">Resumes</TabsTrigger>
          <TabsTrigger value="JOB_DESCRIPTION">Job descriptions</TabsTrigger>
        </TabsList>
        {(['RESUME', 'JOB_DESCRIPTION'] as const).map((k) => (
          <TabsContent key={k} value={k} className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
            <DocumentList kind={k} />
            <div className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 text-sm font-medium">Add {k === 'RESUME' ? 'a resume' : 'a job description'}</h2>
              <DocumentPicker kind={k} selectedId={null} onSelect={() => {}} />
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </>
  )
}

function DocumentList({ kind }: { kind: DocumentKind }) {
  const { data: docs = [], isLoading } = useDocuments(kind)
  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>
  if (!docs.length) {
    return (
      <div className="grid place-items-center rounded-xl border border-dashed p-10 text-sm text-muted-foreground">
        Nothing here yet.
      </div>
    )
  }
  return (
    <ul className="grid content-start gap-3">
      {docs.map((doc) => (
        <DocumentCard key={doc.id} doc={doc} />
      ))}
    </ul>
  )
}

function DocumentCard({ doc }: { doc: VettlyDocument }) {
  const remove = useDeleteDocument()
  return (
    <li className="rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <DocumentStatusIcon doc={doc} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{doc.title}</div>
          <div className="text-xs text-muted-foreground">
            {formatDate(doc.createdAt)}
            {doc.status === 'READY' && ` · ${doc._count.chunks} indexed chunks`}
            {doc.status === 'PROCESSING' && ' · analysing…'}
            {doc.error && ` · ${doc.error}`}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Delete document"
          onClick={() => remove.mutateAsync(doc.id).catch((e: Error) => toast.error(e.message))}
        >
          <Trash2 />
        </Button>
      </div>
      {doc.profile && <ProfileSummary doc={doc} />}
    </li>
  )
}

function ProfileSummary({ doc }: { doc: VettlyDocument }) {
  if (doc.kind === 'RESUME') {
    const p = doc.profile as ResumeProfile
    return (
      <div className="mt-3 space-y-2 border-t pt-3">
        <p className="text-sm text-muted-foreground">{p.headline}</p>
        <div className="flex flex-wrap gap-1">
          {p.skills.slice(0, 14).map((s) => (
            <Badge key={s.name} variant="secondary">
              {s.name}
            </Badge>
          ))}
        </div>
      </div>
    )
  }
  const p = doc.profile as JobProfile
  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      <p className="text-sm text-muted-foreground">
        {p.title}
        {p.company && ` · ${p.company}`} · <span className="capitalize">{p.seniority}</span> · {p.domain}
      </p>
      <div className="flex flex-wrap gap-1">
        {p.mustHaveSkills.slice(0, 14).map((s) => (
          <Badge key={s} variant="secondary">
            {s}
          </Badge>
        ))}
      </div>
    </div>
  )
}
