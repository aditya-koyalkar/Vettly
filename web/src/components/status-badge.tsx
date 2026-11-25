import { Loader2 } from 'lucide-react'
import { STATUS_LABEL } from '@/lib/format'
import type { SessionStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

const STYLES: Record<SessionStatus, string> = {
  PREPARING: 'bg-primary/10 text-primary',
  READY: 'bg-success/12 text-success',
  IN_PROGRESS: 'bg-warning/15 text-warning',
  ANALYZING: 'bg-primary/10 text-primary',
  COMPLETED: 'bg-muted text-muted-foreground',
  FAILED: 'bg-destructive/10 text-destructive',
}

const SPINNING: SessionStatus[] = ['PREPARING', 'ANALYZING']

export function StatusBadge({ status, className }: { status: SessionStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        STYLES[status],
        className,
      )}
    >
      {SPINNING.includes(status) && <Loader2 className="size-3 animate-spin" aria-hidden />}
      {STATUS_LABEL[status]}
    </span>
  )
}
