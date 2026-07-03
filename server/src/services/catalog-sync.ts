import type DatabaseType from 'better-sqlite3';
import { getDb, setSetting, getSetting } from '../db/index.js';
import { hasProvider, registerFromCatalog, type CatalogPlatform } from '../providers/index.js';
import { MEDIA_PLATFORMS } from './media.js';
import type { Platform } from '@freellmapi/shared/types.js';
import type { Scheduler } from '../lib/scheduler.js';
import {
  applyAllModelOverrides,
  applyModelOverrides,
  deleteTombstonedCatalogModels,
  isCatalogModelTombstoned,
} from './model-state.js';

// ========================================================================
// catalog-sync — keeps the local model catalog in step with published data.
//
// Data source (single authoritative source):
//   freellmapi-augmented — a static JSON catalog containing the merged
//   v1 catalog data + yangmao.ai free-tier coverage, with intelligence/
//   speed rankings, quirks, and metadata.
//   Refreshed by the upstream CI; synced here every 12 hours.
//
// The augmented catalog is a static JSON file — no signature verification.
// Model data, quirks, and rankings are applied directly to the local DB.
// ========================================================================

const AUGMENTED_CATALOG_URL =
  'https://git.260123.xyz/narrator-z/freellmapi-augmented/raw/branch/main/output/augmented_catalog.json';

const SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000; // twice daily
const BOOT_DELAY_MS = 10 * 1000;
const FETCH_TIMEOUT_MS = 20 * 1000;

// yangmao-* platforms in the augmented catalog are passthrough wrappers that
// map to existing registered providers. Remap them so models get stored under
// the correct platform and pass the hasProvider() check.
const YANGMAO_PLATFORM_ALIASES: Record<string, string> = {
  'yangmao-anyscale': 'anyscale',
  'yangmao-baichuan': 'baichuan',
  'yangmao-huggingface': 'huggingface',
  'yangmao-moonshot': 'kimi',
  'yangmao-siliconcloud': 'siliconflow',
  'yangmao-baidu': 'ernie',
  'yangmao-alibaba': 'qwen',
};

// Generative-media modalities are routed into the separate media_models table
// (see services/media.ts), never into the chat `models` table.
const MEDIA_MODALITIES = new Set(['image', 'audio']);

// settings table keys
const SETTING_APPLIED_VERSION = 'catalog_applied_version';
const SETTING_APPLIED_JSON = 'catalog_applied_json';
const SETTING_LAST_SYNC_MS = 'catalog_last_sync_ms';
const SETTING_LAST_ERROR = 'catalog_last_error';

// ---- Catalog data types (wire format of the augmented catalog) ----

export interface AugmentedCatalogModel {
  platform: string;
  modelId: string;
  displayName: string;
  intelligenceRank: number | null;
  speedRank: number | null;
  sizeLabel: string | null;
  limits: { rpm: number | null; rpd: number | null; tpm: number | null; tpd: number | null };
  monthlyTokenBudget: string | null;
  contextWindow: number | null;
  enabled: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
  modality?: string;
  mediaNote?: string;
}

interface CatalogQuirk {
  slug: string;
  title: string;
  body: string;
  severity: 'blocker' | 'warning' | 'info';
  targets: { platform: string | null; modelGlob: string | null }[];
}

interface Catalog {
  version: string;
  generatedAt: string;
  tier: 'live' | 'monthly';
  platforms: CatalogPlatform[];
  models: AugmentedCatalogModel[];
  quirks: CatalogQuirk[];
  counts?: { platforms: number; models: number; enabledModels: number; quirks: number; baseModelsCount: number };
}

export interface SyncResult {
  ok: boolean;
  action: 'applied' | 'up_to_date' | 'error';
  version?: string;
  detail?: string;
  counts?: { updated: number; inserted: number; removed: number; skippedUnknownPlatform: number; quirks: number };
}

export interface CatalogSyncState {
  baseUrl: string;
  appliedVersion: string | null;
  lastSyncMs: number | null;
  lastError: string | null;
}

// ---- Helpers ----

/** Minimal structural check for the augmented catalog. */
function isCatalog(value: unknown): value is Catalog {
  const c = value as Catalog;
  return (
    !!c &&
    typeof c.version === 'string' &&
    typeof c.generatedAt === 'string' &&
    Array.isArray(c.models) &&
    Array.isArray(c.quirks) &&
    c.models.every(
      (m) =>
        typeof m?.platform === 'string' &&
        typeof m?.modelId === 'string' &&
        typeof m?.displayName === 'string' &&
        typeof m?.enabled === 'boolean' &&
        !!m?.limits &&
        typeof m.limits === 'object',
    ) &&
    c.quirks.every((q) => typeof q?.slug === 'string' && Array.isArray(q?.targets))
  );
}

// ---- Fetch the augmented catalog ----

async function fetchAugmentedCatalog(): Promise<Catalog> {
  const res = await fetch(AUGMENTED_CATALOG_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

  if (!res.ok) throw new Error(`augmented catalog fetch failed: HTTP ${res.status}`);

  const bytes = Buffer.from(await res.arrayBuffer());
  const parsed: unknown = JSON.parse(bytes.toString('utf8'));
  if (!isCatalog(parsed)) throw new Error('augmented catalog payload has unexpected shape');
  return parsed;
}

function routableContextWindow(platform: string, modelId: string, contextWindow: number | null): number | null {
  if (platform === 'github' && modelId === 'openai/gpt-4.1') return 8000;
  return contextWindow;
}

// ---- applyCatalog (unchanged write path) ----
/**
 * Apply a catalog to the local DB inside one transaction.
 *
 * Rules of engagement with user data:
 *  - metadata (name, ranks, limits, context, capabilities) tracks the catalog
 *    unless the user has an explicit local override;
 *  - catalog enabled=false force-disables (the model is dead upstream), but
 *    enabled=true never re-enables a model the user turned off themselves;
 *  - models the user added via custom providers (platform='custom' or bound to
 *    a key) are never touched;
 *  - catalog models the user deleted stay deleted via tombstones;
 *  - models that vanished from the catalog are deleted, exactly like the
 *    dead-model migrations do (fallback_config row first, FK order).
 */
export function applyCatalog(db: DatabaseType.Database, catalog: Catalog): NonNullable<SyncResult['counts']> {
  const counts = { updated: 0, inserted: 0, removed: 0, skippedUnknownPlatform: 0, quirks: 0 };

  const selectModel = db.prepare('SELECT id, enabled FROM models WHERE platform = ? AND model_id = ?');
  const updateModel = db.prepare(`
    UPDATE models SET
      display_name = @displayName,
      intelligence_rank = COALESCE(@intelligenceRank, 50),
      speed_rank = COALESCE(@speedRank, 50),
      size_label = COALESCE(@sizeLabel, 'Medium'),
      rpm_limit = @rpm, rpd_limit = @rpd, tpm_limit = @tpm, tpd_limit = @tpd,
      monthly_token_budget = COALESCE(@monthlyTokenBudget, ''),
      context_window = @contextWindow,
      supports_vision = @supportsVision, supports_tools = @supportsTools,
      enabled = @enabled
    WHERE id = @id
  `);
  const insertModel = db.prepare(`
    INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, size_label,
                        rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window,
                        enabled, supports_vision, supports_tools)
    VALUES (@platform, @modelId, @displayName,
            COALESCE(@intelligenceRank, 50), COALESCE(@speedRank, 50), COALESCE(@sizeLabel, 'Medium'),
            @rpm, @rpd, @tpm, @tpd, COALESCE(@monthlyTokenBudget, ''), @contextWindow,
            @enabled, @supportsVision, @supportsTools)
  `);

  // Generative-media models go to their own table (never the chat router's pool).
  const selectMedia = db.prepare('SELECT id, enabled FROM media_models WHERE platform = ? AND model_id = ?');
  const updateMedia = db.prepare(`
    UPDATE media_models SET
      display_name = @displayName, modality = @modality, priority = @priority,
      quota_label = @quotaLabel, enabled = @enabled
    WHERE id = @id
  `);
  const insertMedia = db.prepare(`
    INSERT INTO media_models (platform, model_id, display_name, modality, priority, enabled, quota_label)
    VALUES (@platform, @modelId, @displayName, @modality, @priority, @enabled, @quotaLabel)
  `);

  const apply = db.transaction(() => {
    const inCatalog = new Set<string>();
    const inMediaCatalog = new Set<string>();

    for (const m of catalog.models) {
      // Remap yangmao-* wrapper platforms to their real provider.
      const platform = YANGMAO_PLATFORM_ALIASES[m.platform] ?? m.platform;
      const modality = m.modality ?? 'text';
      if (MEDIA_MODALITIES.has(modality)) {
        if (!MEDIA_PLATFORMS.has(platform)) {
          counts.skippedUnknownPlatform++;
          continue;
        }
        if (isCatalogModelTombstoned(db, 'media', platform, m.modelId)) continue;
        inMediaCatalog.add(`${platform}:${m.modelId}`);
        const mrow = selectMedia.get(platform, m.modelId) as { id: number; enabled: number } | undefined;
        const mfields = {
          displayName: m.displayName,
          modality,
          priority: m.intelligenceRank ?? 0,
          quotaLabel: m.mediaNote ?? '',
        };
        if (mrow) {
          const enabled = m.enabled ? mrow.enabled : 0;
          updateMedia.run({ ...mfields, id: mrow.id, enabled });
          counts.updated++;
        } else {
          insertMedia.run({ ...mfields, platform, modelId: m.modelId, enabled: m.enabled ? 1 : 0 });
          counts.inserted++;
        }
        continue;
      }

      if (platform === 'custom' || !hasProvider(platform as Platform)) {
        counts.skippedUnknownPlatform++;
        continue;
      }
      if (isCatalogModelTombstoned(db, 'chat', platform, m.modelId)) continue;
      inCatalog.add(`${platform}:${m.modelId}`);

      const row = selectModel.get(platform, m.modelId) as { id: number; enabled: number } | undefined;
      const fields = {
        displayName: m.displayName,
        intelligenceRank: m.intelligenceRank ?? 50,
        speedRank: m.speedRank ?? 50,
        sizeLabel: m.sizeLabel ?? 'Medium',
        rpm: m.limits.rpm,
        rpd: m.limits.rpd,
        tpm: m.limits.tpm,
        tpd: m.limits.tpd,
        monthlyTokenBudget: m.monthlyTokenBudget,
        contextWindow: routableContextWindow(m.platform, m.modelId, m.contextWindow),
        supportsVision: m.supportsVision ? 1 : 0,
        supportsTools: m.supportsTools ? 1 : 0,
      };
      if (row) {
        const enabled = m.enabled ? row.enabled : 0;
        updateModel.run({ ...fields, id: row.id, enabled });
        applyModelOverrides(db, platform, m.modelId);
        counts.updated++;
      } else {
        insertModel.run({ ...fields, platform, modelId: m.modelId, enabled: m.enabled ? 1 : 0 });
        applyModelOverrides(db, platform, m.modelId);
        counts.inserted++;
      }
    }

    counts.removed += deleteTombstonedCatalogModels(db);
    applyAllModelOverrides(db);

    // Ensure every model has a fallback_config row (same invariant migrations keep).
    const missingFb = db
      .prepare(
        `SELECT m.id FROM models m LEFT JOIN fallback_config f ON m.id = f.model_db_id WHERE f.id IS NULL`,
      )
      .all() as { id: number }[];
    if (missingFb.length > 0) {
      const maxPriority = (db.prepare('SELECT COALESCE(MAX(priority), 0) AS mx FROM fallback_config').get() as { mx: number }).mx;
      const addFb = db.prepare('INSERT INTO fallback_config (model_db_id, priority, enabled) VALUES (?, ?, 1)');
      missingFb.forEach((r, i) => addFb.run(r.id, maxPriority + 1 + i));
    }

    // Remove catalog-managed models that the catalog no longer lists
    const candidates = db
      .prepare(`
        SELECT id, platform, model_id
          FROM models
         WHERE platform != 'custom'
           AND key_id IS NULL
           AND size_label NOT IN ('User', 'Custom')
      `)
      .all() as { id: number; platform: string; model_id: string }[];
    const deleteFb = db.prepare('DELETE FROM fallback_config WHERE model_db_id = ?');
    const deleteModel = db.prepare('DELETE FROM models WHERE id = ?');
    for (const c of candidates) {
      if (!hasProvider(c.platform as Platform)) continue;
      if (!inCatalog.has(`${c.platform}:${c.model_id}`)) {
        deleteFb.run(c.id);
        deleteModel.run(c.id);
        counts.removed++;
      }
    }

    // Remove media models the catalog no longer lists
    const mediaCandidates = db
      .prepare('SELECT id, platform, model_id FROM media_models')
      .all() as { id: number; platform: string; model_id: string }[];
    const deleteMedia = db.prepare('DELETE FROM media_models WHERE id = ?');
    for (const c of mediaCandidates) {
      if (!MEDIA_PLATFORMS.has(c.platform)) continue;
      if (!inMediaCatalog.has(`${c.platform}:${c.model_id}`)) {
        deleteMedia.run(c.id);
        counts.removed++;
      }
    }

    // Quirks are pure content: replace wholesale.
    db.prepare('DELETE FROM quirk_targets').run();
    db.prepare('DELETE FROM quirks').run();
    const insertQuirk = db.prepare(
      `INSERT INTO quirks (slug, title, body, severity, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertTarget = db.prepare(
      `INSERT INTO quirk_targets (quirk_id, platform, model_glob) VALUES (?, ?, ?)`,
    );
    const now = Date.now();
    for (const q of catalog.quirks) {
      const info = insertQuirk.run(q.slug, q.title, q.body, q.severity, now, now);
      for (const t of q.targets) insertTarget.run(info.lastInsertRowid, t.platform ?? null, t.modelGlob ?? null);
      counts.quirks++;
    }
  });

  apply();
  return counts;
}

// ---- Sync orchestration (single source) ----

/**
 * Main sync: fetch the augmented catalog and apply it.
 *
 * The augmented catalog is a pre-merged file containing both the v1 catalog
 * (with full rankings and quirks) and yangmao.ai free-tier coverage.
 * No merge step needed — data is applied directly.
 */
export async function syncCatalog(): Promise<SyncResult> {
  const db = getDb();

  try {
    const catalog = await fetchAugmentedCatalog();

    // Register any new providers from the catalog before applying models,
    // so their models can pass the hasProvider() gate in applyCatalog().
    // Hand-maintained providers are never overwritten.
    const regResult = registerFromCatalog(catalog.platforms);
    if (regResult.added.length > 0) {
      console.log(`[catalog-sync] auto-registered ${regResult.added.length} new provider(s): ${regResult.added.join(', ')}`);
    }
    if (regResult.conflicts.length > 0) {
      console.warn(`[catalog-sync] failed to register ${regResult.conflicts.length} provider(s): ${regResult.conflicts.join(', ')}`);
    }

    const counts = applyCatalog(db, catalog);
    setSetting(SETTING_APPLIED_VERSION, catalog.version);
    setSetting(SETTING_APPLIED_JSON, JSON.stringify(catalog));

    console.log(
      `[catalog-sync] applied augmented v${catalog.version}: ` +
        `${counts.updated} updated, ${counts.inserted} new, ${counts.removed} removed, ` +
        `${counts.quirks} quirks` +
        (counts.skippedUnknownPlatform ? `, ${counts.skippedUnknownPlatform} skipped (unknown platform)` : ''),
    );

    setSetting(SETTING_LAST_SYNC_MS, String(Date.now()));
    setSetting(SETTING_LAST_ERROR, '');
    return { ok: true, action: 'applied', version: catalog.version, counts };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[catalog-sync] ${message}`);
    setSetting(SETTING_LAST_ERROR, message);
    return { ok: false, action: 'error', detail: message };
  }
}

// ---- Cache & lifecycle ----

export function getSyncState(): CatalogSyncState {
  return {
    baseUrl: AUGMENTED_CATALOG_URL,
    appliedVersion: getSetting(SETTING_APPLIED_VERSION) ?? null,
    lastSyncMs: Number(getSetting(SETTING_LAST_SYNC_MS)) || null,
    lastError: getSetting(SETTING_LAST_ERROR) || null,
  };
}

const CATALOG_SCHEMA_VERSION = 3; // bumped for new augmented catalog format

/**
 * Re-apply the cached (already applied) catalog after boot.
 *
 * On every boot the migrations re-assert the bundled baseline (INSERT OR
 * IGNORE), which would re-add deleted models and drift the DB away from the
 * last sync. Re-applying from the local cache is synchronous, needs no
 * network, and keeps the catalog authoritative even offline.
 *
 * Caches from before schemaVersion 3 (old v1/yangmao format) are silently
 * discarded — they have a different structure and would fail validation.
 */
export function reapplyCachedCatalog(): { reapplied: boolean; version?: string } {
  try {
    const raw = getSetting(SETTING_APPLIED_JSON);
    if (!raw) return { reapplied: false };
    const parsed: unknown = JSON.parse(raw);
    if (!isCatalog(parsed)) return { reapplied: false };
    // Old caches (schemaVersion < 3) have a different structure — discard.
    const record = parsed as unknown as Record<string, unknown>;
    if (record.schemaVersion && (record.schemaVersion as number) < 3) {
      console.log(`[catalog-sync] discarding old-format cache (schemaVersion ${record.schemaVersion})`);
      getDb().prepare('DELETE FROM settings WHERE key = ? OR key = ?').run('catalog_applied_version', 'catalog_applied_json');
      return { reapplied: false };
    }

    // Backfill schemaVersion for caches that predate this field.
    if (!record.schemaVersion) {
      record.schemaVersion = 3;
      setSetting(SETTING_APPLIED_JSON, JSON.stringify(record));
    }
    applyCatalog(getDb(), parsed as Catalog);
    console.log(`[catalog-sync] re-applied cached augmented catalog v${(parsed as Catalog).version} after boot`);
    return { reapplied: true, version: (parsed as Catalog).version };
  } catch (err) {
    console.warn(`[catalog-sync] cached catalog re-apply failed: ${err instanceof Error ? err.message : err}`);
    return { reapplied: false };
  }
}

let cancelBootTimer: (() => void) | null = null;
let cancelInterval: (() => void) | null = null;

export function startCatalogSync(scheduler: Scheduler): void {
  if (cancelInterval) return;
  if (process.env.CATALOG_SYNC_DISABLED === '1') {
    console.log('[catalog-sync] disabled via CATALOG_SYNC_DISABLED=1');
    return;
  }
  reapplyCachedCatalog();
  const run = () => {
    void syncCatalog();
  };
  cancelBootTimer = scheduler.after(BOOT_DELAY_MS, run);
  cancelInterval = scheduler.every(SYNC_INTERVAL_MS, run);
  console.log(`[catalog-sync] polling augmented catalog every ${SYNC_INTERVAL_MS / 3600000}h`);
}

export function stopCatalogSync(): void {
  if (cancelBootTimer) {
    cancelBootTimer();
    cancelBootTimer = null;
  }
  if (cancelInterval) {
    cancelInterval();
    cancelInterval = null;
  }
}
