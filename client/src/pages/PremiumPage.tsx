import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/i18n'

interface CatalogSyncState {
  baseUrl: string
  appliedVersion: string | null
  lastSyncMs: number | null
  lastError: string | null
}

interface CatalogStatus {
  catalog: CatalogSyncState
}

function fmtWhen(ms: number | null): string | null {
  if (!ms) return null
  return new Date(ms).toLocaleString()
}

export default function PremiumPage() {
  const { t } = useI18n()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery<CatalogStatus>({
    queryKey: ['premium'],
    queryFn: () => apiFetch('/api/premium'),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['premium'] })
    queryClient.invalidateQueries({ queryKey: ['models'] })
  }

  const syncNow = useMutation({
    mutationFn: () => apiFetch<{ sync: Record<string, unknown> }>('/api/premium/sync', { method: 'POST' }),
    onSuccess: invalidate,
  })

  if (isLoading || !data) {
    return (
      <div>
        <PageHeader title={t('premium.title')} description={t('premium.description')} />
        <p className="text-sm text-muted-foreground">{t('premium.loading')}</p>
      </div>
    )
  }

  const { catalog } = data
  const version = catalog.appliedVersion
  const syncTime = catalog.lastSyncMs

  return (
    <div>
      <PageHeader
        title={t('premium.title')}
        description={t('premium.description')}
        actions={
          <Button variant="outline" size="sm" onClick={() => syncNow.mutate()} disabled={syncNow.isPending}>
            <RefreshCw className={syncNow.isPending ? 'animate-spin' : ''} />
            {syncNow.isPending ? t('premium.syncing') : t('premium.checkForUpdates')}
          </Button>
        }
      />

      <div className="space-y-8">
        {/* Catalog feed state */}
        <section>
          <h2 className="text-sm font-medium mb-3">{t('premium.catalogFeed')}</h2>
          <div className="rounded-3xl border bg-card p-5">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex items-center gap-2">
                <span className="inline-block size-2 rounded-full bg-emerald-500" />
                <span className="text-sm font-medium">{t('premium.liveFeed')}</span>
                <Badge variant="outline" className="font-mono text-[11px]">
                  {version ? version.substring(0, 10) : t('premium.bundled')}
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground">{t('premium.lastChecked', { when: fmtWhen(syncTime) ?? t('common.never') })}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              {t('premium.syncDescription')}
            </p>
            {catalog.lastError && (
              <p className="text-destructive text-xs mt-2">{t('premium.lastSyncProblem', { error: catalog.lastError })}</p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
