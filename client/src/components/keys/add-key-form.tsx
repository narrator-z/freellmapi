import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ModelCombobox } from '@/components/model-combobox'
import { FieldError } from '@/components/ui/field-error'
import type { Platform } from '../../../../shared/types'
import { useI18n } from '@/i18n'
import { toast } from '@/lib/toast'
import { GetKeyLink, LISTED_PLATFORMS, usePlatforms } from './shared'
import { invalidateSearchQueries, SEARCH_PROVIDERS } from '@/lib/search'
import type { ScopeCandidate } from '@/lib/model-scope-selection'

// A key that just landed, plus the models the picker should offer for it.
// Exported so add-key-dialog can type its post-add scope offer. The fork keeps
// the registry-driven platform list (usePlatforms), so this pane never emits
// an offer and the scope picker stays dormant — matching the fork's original
// behaviour. The shape is kept identical to upstream so the dialog contract holds.
export interface AddedKeyScopeOffer {
  keyId: number
  platformLabel: string
  candidates: ScopeCandidate[]
}

// The "Provider key" pane of the Add key dialog: paste a credential for a known
// provider. Extracted verbatim from the old inline KeysPage form so all field
// validation, the keyless/Cloudflare special cases, and the POST /api/keys
// mutation stay identical. On success it toasts and asks the dialog to close.
export function AddKeyForm({ onSuccess, initialPlatform }: { onSuccess: () => void; initialPlatform?: Platform }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [platform, setPlatform] = useState<Platform | ''>(initialPlatform ?? '')
  const [apiKey, setApiKey] = useState('')
  const [accountId, setAccountId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [label, setLabel] = useState('')
  const [addAttempted, setAddAttempted] = useState(false)

  const addKey = useMutation({
    meta: { silenceToast: true },
    mutationFn: (body: { platform: string; key: string; label?: string }) =>
      apiFetch<{ notice?: string | null }>('/api/keys', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      invalidateSearchQueries(queryClient)
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
      toast.success(t('keys.keyAdded'))
      // Server notice when the key is for a platform with no models in the
      // current catalog tier yet (#438) — surfaced as a toast now that the
      // dialog closes on success.
      if (data?.notice) toast.info(data.notice)
      onSuccess()
    },
  })

  const speechFlow = platform === 'speechflow'
  const needsAccountId = speechFlow || platform === 'cloudflare'
  const needsProjectId = platform === 'jamai'
  const platforms = usePlatforms()
  // Key-optional providers (Kilo, OVH, AI Horde) work anonymously, but accept a
  // real key too (#1331): the field stays editable and may be left blank.
  const isKeyless = [...SEARCH_PROVIDERS, ...platforms].find(p => p.value === platform)?.keyless ?? false
  const platformOptions = useMemo(
    () => [
      ...SEARCH_PROVIDERS.map(p => ({ ...p, group: t('search.pickerSearch') })),
      ...LISTED_PLATFORMS.map(p => ({ ...p, group: t('search.pickerModels') })),
    ],
    [t],
  )

  // Field-level validation: the submit stays clickable and reveals what is
  // missing instead of being silently disabled.
  const platformError = !platform ? t('validation.required') : null
  const keyError = !isKeyless && !apiKey.trim() ? t('validation.required') : null
  const accountIdError = needsAccountId && !accountId.trim() ? t('validation.required') : null
  const projectIdError = needsProjectId && !projectId.trim() ? t('validation.required') : null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (platformError || keyError || accountIdError || projectIdError) {
      setAddAttempted(true)
      return
    }
    setAddAttempted(false)
    // A blank key on a key-optional provider enables its anonymous tier; the
    // backend stores a sentinel and sends no Authorization header.
    const key = needsProjectId ? `${projectId.trim()}:${apiKey.trim()}`
      : isKeyless ? apiKey.trim() : (needsAccountId ? `${accountId.trim()}:${apiKey.trim()}` : apiKey)
    addKey.mutate({ platform, key, label: label || undefined })
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex flex-wrap gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">{t('keys.platform')}</Label>
          <ModelCombobox
            value={platform}
            options={platformOptions}
            onSelect={v => {
              if (v !== platform && (speechFlow || v === 'speechflow')) { setApiKey(''); setAccountId('') }
              setPlatform(v as Platform)
            }}
            ariaLabel={t('keys.platform')}
            triggerPlaceholder={t('keys.selectPlatform')}
            placeholder={t('keys.filterPlaceholder')}
            emptyText={t('keys.noFilterMatch')}
            align="start"
            ariaInvalid={addAttempted && !!platformError}
            triggerClassName={`flex h-8 w-[220px] items-center justify-between gap-2 whitespace-nowrap rounded-lg border bg-transparent px-3 text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 ${addAttempted && platformError ? 'border-destructive' : 'border-input'}`}
          />
          {addAttempted && <FieldError error={platformError} />}
          {(() => {
            const sel = [...SEARCH_PROVIDERS, ...platforms].find(p => p.value === platform)
            return sel?.url ? <div className="pt-0.5"><GetKeyLink url={sel.url} /></div> : null
          })()}
        </div>
        {needsProjectId && (
          <div className="space-y-1.5">
            <Label htmlFor="jamai-project-id" className="text-xs">{t('keys.projectId')}</Label>
            <Input id="jamai-project-id" value={projectId} onChange={e => setProjectId(e.target.value)}
              placeholder="proj_…" autoComplete="off" className="w-[220px] font-mono text-xs"
              aria-invalid={addAttempted && !!projectIdError} />
            {addAttempted && <FieldError error={projectIdError} />}
          </div>
        )}
        {needsAccountId && (
          <div className="space-y-1.5">
            <Label className="text-xs">{speechFlow ? 'keyId' : t('keys.accountId')}</Label>
            <Input
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
              placeholder={speechFlow ? 'keyId' : 'a1b2c3d4…'}
              className="w-[200px] font-mono text-xs"
              aria-invalid={addAttempted && !!accountIdError}
            />
            {addAttempted && <FieldError error={accountIdError} />}
          </div>
        )}
        <div className="space-y-1.5 flex-1 min-w-[240px]">
          <Label className="text-xs">{needsProjectId ? `${t('keys.apiToken')} (PAT)` : needsAccountId ? t('keys.apiToken') : t('keys.customApiKey')}</Label>
          <Input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={needsProjectId ? 'jamai_pat_…' : isKeyless ? t('keys.keyOptionalPlaceholder') : (needsAccountId ? t('keys.bearerTokenPlaceholder') : t('keys.pasteKeyPlaceholder'))}
            className="font-mono text-xs"
            aria-invalid={addAttempted && !!keyError}
          />
          {addAttempted && <FieldError error={keyError} />}
          {isKeyless && (
            <p className="text-[11px] text-muted-foreground">
              {t('keys.keyOptionalHint')}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t('keys.label')}</Label>
          <div className="flex flex-wrap items-center space-x-3">
            <Input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder={t('keys.customDisplayNameOptional')}
              className="w-[160px]"
            />
            <Button type="submit" size="sm" disabled={addKey.isPending}>
              {addKey.isPending ? t('keys.adding') : isKeyless && !apiKey.trim() ? t('keys.enable') : t('keys.addKey')}
            </Button>
          </div>
        </div>
      </form>
      {addKey.isError && (
        <p className="text-destructive text-xs mt-2">{(addKey.error as Error).message}</p>
      )}
    </div>
  )
}
