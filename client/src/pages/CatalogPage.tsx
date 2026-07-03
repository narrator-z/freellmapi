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

export default function CatalogPage() {
  const { t } = useI18n()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery<CatalogStatus>({
    queryKey: ['catalog'],
    queryFn: () => apiFetch('/api/catalog'),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['catalog'] })
    queryClient.invalidateQueries({ queryKey: ['models'] })
  }

  const syncNow = useMutation({
    mutationFn: () => apiFetch<{ sync: Record<string, unknown> }>('/api/catalog/sync', { method: 'POST' }),
    onSuccess: invalidate,
  })

  if (isLoading || !data) {
    return (
      <div>
        <PageHeader title={t('catalog.title')} description={t('catalog.description')} />
        <p className="text-sm text-muted-foreground">{t('catalog.loading')}</p>
      </div>
    )
  }

  const { catalog } = data
  const version = catalog.appliedVersion
  const syncTime = catalog.lastSyncMs

  return (
    <div>
      <PageHeader
        title={t('catalog.title')}
        description={t('catalog.description')}
        actions={
          <Button variant="outline" size="sm" onClick={() => syncNow.mutate()} disabled={syncNow.isPending}>
            <RefreshCw className={syncNow.isPending ? 'animate-spin' : ''} />
            {syncNow.isPending ? t('catalog.syncing') : t('catalog.checkForUpdates')}
          </Button>
        }
      />

      <div className="space-y-8">
        {/* Catalog feed state */}
        <section>
          <h2 className="text-sm font-medium mb-3">{t('catalog.catalogFeed')}</h2>
          <div className="rounded-3xl border bg-card p-5">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex items-center gap-2">
                <span className="inline-block size-2 rounded-full bg-emerald-500" />
                <span className="text-sm font-medium">{t('catalog.feedLabel')}</span>
                <Badge variant="outline" className="font-mono text-[11px]">
                  {version ? version.substring(0, 10) : t('catalog.bundled')}
                </Badge>
              </div>
              <span className="text-xs text-muted-foreground">{t('catalog.lastChecked', { when: fmtWhen(syncTime) ?? t('common.never') })}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              {t('catalog.syncDescription')}
            </p>
            {catalog.lastError && (
              <p className="text-destructive text-xs mt-2">{t('catalog.lastSyncProblem', { error: catalog.lastError })}</p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
