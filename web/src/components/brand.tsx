import { Link } from 'react-router'
import { cn } from '@/lib/utils'

export function Logo({ className, to = '/' }: { className?: string; to?: string }) {
  return (
    <Link to={to} className={cn('flex items-center gap-2 font-semibold tracking-tight', className)}>
      <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
          <path d="M4 6l8 13 8-13" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span>Vettly</span>
    </Link>
  )
}
