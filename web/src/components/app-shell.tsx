import { FileText, LayoutDashboard, LogOut, Plus } from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { Logo } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/auth'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/app/documents', label: 'Documents', icon: FileText, end: false },
]

export function AppShell() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <Logo to="/app" />
          <nav className="flex items-center gap-1">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground',
                    isActive && 'bg-muted text-foreground',
                  )
                }
              >
                <Icon className="size-4" aria-hidden />
                <span className="hidden sm:inline">{label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" onClick={() => navigate('/app/new')}>
              <Plus /> <span className="hidden sm:inline">New interview</span>
            </Button>
            <div className="hidden text-right text-xs leading-tight md:block">
              <div className="font-medium">{user?.name}</div>
              <div className="text-muted-foreground">{user?.email}</div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Sign out"
              onClick={async () => {
                await signOut()
                navigate('/')
              }}
            >
              <LogOut />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  )
}
