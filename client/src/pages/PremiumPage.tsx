import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'

interface LicenseStatus {
  valid: boolean
  plan: 'annual' | 'lifetime' | null
  status: string | null
  expiresAt: string | null
  cancelAtPeriodEnd?: boolean
  reason?: string
  checkedAtMs: number
}

interface CatalogSyncState {
  baseUrl: string
  appliedVersion: string | null
  appliedTier: string | null
  lastSyncMs: number | null
  lastError: string | null
}

interface PremiumStatus {
  hasKey: boolean
  maskedKey: string | null
  license: LicenseStatus | null
  catalog: CatalogSyncState
  siteUrl: string
}

function fmtWhen(ms: number | null): string {
  if (!ms) return 'never'
  return new Date(ms).toLocaleString()
}

export default function PremiumPage() {
  const queryClient = useQueryClient()
  const [keyInput, setKeyInput] = useState('')

  const { data, isLoading } = useQuery<PremiumStatus>({
    queryKey: ['premium'],
    queryFn: () => apiFetch('/api/premium'),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['premium'] })
    queryClient.invalidateQueries({ queryKey: ['models'] })
  }

  const activate = useMutation({
    mutationFn: (key: string) =>
      apiFetch('/api/premium/key', { method: 'POST', body: JSON.stringify({ key }) }),
    onSuccess: () => {
      setKeyInput('')
      invalidate()
    },
  })

  const removeKey = useMutation({
    mutationFn: () => apiFetch('/api/premium/key', { method: 'DELETE' }),
    onSuccess: invalidate,
  })

  const syncNow = useMutation({
    mutationFn: () => apiFetch('/api/premium/sync', { method: 'POST' }),
    onSuccess: invalidate,
  })

  if (isLoading || !data) {
    return (
      <div>
        <PageHeader title="Premium" description="The live model catalog, on every device." />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  const { hasKey, maskedKey, catalog } = data

  return (
    <div>
      <PageHeader
        title="Premium"
        description="The live model catalog, on every device."
        actions={
          <Button variant="outline" size="sm" onClick={() => syncNow.mutate()} disabled={syncNow.isPending}>
            <RefreshCw className={syncNow.isPending ? 'animate-spin' : ''} />
            {syncNow.isPending ? 'Syncing…' : 'Check for updates'}
          </Button>
        }
      />

      <div className="space-y-8">
        {/* Catalog feed state — always live */}
        <section>
          <h2 className="text-sm font-medium mb-3">Catalog feed</h2>
          <div className="rounded-3xl border bg-card p-5">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex items-center gap-2">
                <span className="inline-block size-2 rounded-full bg-emerald-500" />
                <span className="text-sm font-medium">Live feed</span>
                <Badge variant="outline" className="font-mono text-[11px]">
                  {catalog.appliedVersion ?? 'bundled'}
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground">Last checked: {fmtWhen(catalog.lastSyncMs)}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              New free models, quota changes, and quirk fixes land here within hours of being shipped. The app checks automatically twice a day; nothing to do.
            </p>
            {catalog.lastError && (
              <p className="text-destructive text-xs mt-2">Last sync problem: {catalog.lastError}</p>
            )}
          </div>
        </section>

        {/* License key management */}
        <section>
          <h2 className="text-sm font-medium mb-3">License</h2>
          {hasKey ? (
            <div className="rounded-3xl border bg-card p-5 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-sm">{maskedKey}</span>
                <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-transparent">
                  Active
                </Badge>
              </div>

              <p className="text-xs text-muted-foreground">
                License key is active. The catalog is always served as the live tier.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeKey.mutate()}
                  disabled={removeKey.isPending}
                  className="text-muted-foreground"
                >
                  Remove key from this device
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Removing the key only deactivates this device; your purchase is untouched.
              </p>
            </div>
          ) : (
            <div className="rounded-3xl border bg-card p-5 space-y-4">
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (keyInput.trim()) activate.mutate(keyInput.trim())
                }}
              >
                <div className="space-y-1.5 flex-1 min-w-[260px]">
                  <Label className="text-xs">License key</Label>
                  <Input
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder="fla_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                    className="font-mono text-xs"
                    autoComplete="off"
                  />
                </div>
                <Button type="submit" size="sm" disabled={!keyInput.trim() || activate.isPending}>
                  {activate.isPending ? 'Activating…' : 'Activate'}
                </Button>
              </form>
              {activate.isError && (
                <p className="text-destructive text-xs">{(activate.error as Error).message}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Enter your license key to activate. The catalog is always served as the live tier.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}