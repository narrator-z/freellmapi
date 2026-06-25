import crypto from 'crypto';
import type DatabaseType from 'better-sqlite3';
import { getDb, setSetting, getSetting } from '../db/index.js';
import { hasProvider } from '../providers/index.js';
import { MEDIA_PLATFORMS } from './media.js';
import type { Platform } from '@freellmapi/shared/types.js';

// ========================================================================
// catalog-sync — keeps the local model catalog in step with published data.
//
// Data sources (two-tier merge):
//   1. PRIMARY: yangmao.ai/data/exports/ai-free-tiers.json — the
//      authoritative list of free/live API models. Always the latest export.
//   2. SECONDARY: api.freellmapi.co/v1/latest — intelligence/speed
//      rankings, quirks, and metadata enrichment. Ed25519‑signed.
//
// The secondary source provides ranking metadata that yangmao doesn't have.
// If the ranking fetch fails (network, bad signature) the yangmao models are
// still applied, just without ranking data — the sync is never blocked by it.
//
// There is no Premium/free tier distinction. Every install gets the same
// catalog, refreshed every 12 hours.
// ========================================================================

const YANGMAO_URL = 'https://yangmao.ai/data/exports/ai-free-tiers.json';
const DEFAULT_BASE_URL = 'https://api.freellmapi.co';

// Ed25519 public key for the original catalog (ranking enrichment only).
const PINNED_CATALOG_PUBKEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAq9yv4+3EeyMHKsfVYBhkcz1lYgIXSUeHNnN6tNgYX3k=
-----END PUBLIC KEY-----
`;

// Floor for the ranking catalog. Yangmao data is always current, so this
// only applies to the optional ranking overlay.
const MIN_RANKING_VERSION = '2026.01.01';

const SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000; // twice daily
const BOOT_DELAY_MS = 10 * 1000;
const FETCH_TIMEOUT_MS = 20 * 1000;

// Generative-media modalities are routed into the separate media_models table
// (see services/media.ts), never into the chat `models` table.
const MEDIA_MODALITIES = new Set(['image', 'audio']);

// settings table keys
const SETTING_APPLIED_VERSION = 'catalog_applied_version';
const SETTING_APPLIED_JSON = 'catalog_applied_json';
const SETTING_LAST_SYNC_MS = 'catalog_last_sync_ms';
const SETTING_LAST_ERROR = 'catalog_last_error';

export function catalogBaseUrl(): string {
  return (process.env.CATALOG_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
}

function catalogPublicKey(): crypto.KeyObject {
  const pem = process.env.CATALOG_PUBKEY
    ? process.env.CATALOG_PUBKEY.replace(/\\n/g, '\n')
    : PINNED_CATALOG_PUBKEY;
  return crypto.createPublicKey({ key: pem, format: 'pem' });
}

// ---- Catalog data types (wire format of the ranking source) ----

interface CatalogQuirk {
  slug: string;
  title: string;
  body: string;
  severity: 'blocker' | 'warning' | 'info';
  targets: { platform: string | null; modelGlob: string | null }[];
}

interface CatalogModel {
  platform: string;
  modelId: string;
  displayName: string;
  intelligenceRank: number;
  speedRank: number;
  sizeLabel: string;
  limits: { rpm: number | null; rpd: number | null; tpm: number | null; tpd: number | null };
  monthlyTokenBudget: string | null;
  contextWindow: number | null;
  enabled: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
  modality?: string;
  mediaNote?: string;
}

interface Catalog {
  version: string;
  generatedAt: string;
  tier: 'live' | 'monthly';
  models: CatalogModel[];
  quirks: CatalogQuirk[];
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

// ---- yangmao.ai types ----

interface YangmaoModel {
  name: string;
  context: string;
  rate_limit: string;
  notes: string;
}

interface YangmaoProvider {
  id: string;
  name: string;
  openai_compatible: boolean;
  has_free_api: boolean;
  models: YangmaoModel[];
}

interface YangmaoResponse {
  schema_version: string;
  generated_at: string;
  providers: YangmaoProvider[];
}

// ---- Helpers ----

/** Minimal structural check for the ranking catalog. */
function isCatalog(value: unknown): value is Catalog {
  const c = value as Catalog;
  return (
    !!c &&
    typeof c.version === 'string' &&
    (c.tier === 'live' || c.tier === 'monthly') &&
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

function parseContext(s: string): number | null {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  if (t === 'n/a' || t === 'varies' || t === '' || t === 'model dependent') return null;
  const m = t.match(/^(\d+)\s*(k|m)?$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (isNaN(n)) return null;
  if (m[2] === 'k') return n * 1024;
  if (m[2] === 'm') return n * 1024 * 1024;
  return n;
}

function parseRateLimit(s: string): { rpm: number | null; rpd: number | null; tpm: number | null; tpd: number | null } {
  const result = { rpm: null as number | null, rpd: null as number | null, tpm: null as number | null, tpd: null as number | null };
  if (!s) return result;

  // Try patterns like "30 RPM", "50 RPD", "30 RPM / 60K TPM", "1000 RPD / 350K TPD"
  const parts = s.split(/[/,，、]/);
  for (const part of parts) {
    const p = part.trim().toLowerCase();
    const m = p.match(/^(\d+(?:\.\d+)?)\s*(rpm|rpd|tpm|tpd)$/);
    if (m) {
      const val = parseInt(m[1], 10);
      if (m[2] === 'rpm') result.rpm = val;
      else if (m[2] === 'rpd') result.rpd = val;
      else if (m[2] === 'tpm') result.tpm = val;
      else if (m[2] === 'tpd') result.tpd = val;
    }
  }
  return result;
}

// ---- Yangmao fetch & parse ----

/** Single model's ranking data extracted from the original catalog. */
interface RankingValue {
  intelligenceRank: number;
  speedRank: number;
  sizeLabel: string;
  limits: { rpm: number | null; rpd: number | null; tpm: number | null; tpd: number | null };
  monthlyTokenBudget: string | null;
  contextWindow: number | null;
  supportsVision: boolean;
  supportsTools: boolean;
}

async function fetchYangmaoData(): Promise<{ models: CatalogModel[]; version: string }> {
  const res = await fetch(YANGMAO_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`yangmao fetch failed: HTTP ${res.status}`);

  const raw: unknown = await res.json();
  const body = raw as YangmaoResponse;
  if (!body || !body.providers || !body.generated_at) {
    throw new Error('yangmao payload has unexpected shape');
  }

  const version = body.generated_at;

  // Determine which mapping we use for known platform -> yangmao provider id
  // Mapping from yangmao provider id to our Platform:
  // Most yangmao ids already match our Platform enum directly.
  // Some need special handling.
  const platformAliases: Record<string, string> = {
    // yangmao uses shorter ids in some cases
  };

  const models: CatalogModel[] = [];
  for (const p of body.providers) {
    // Only include providers that are OpenAI-compatible AND have a free API tier
    if (!p.openai_compatible || !p.has_free_api) continue;
    if (!p.models || p.models.length === 0) continue;

    const platform = platformAliases[p.id] ?? p.id;

    for (const m of p.models) {
      const limits = parseRateLimit(m.rate_limit);
      const contextWindow = parseContext(m.context);

      // Heuristic: detect modality from model name keywords
      let modality: string | undefined;
      if (/^(dall-e|stable-diffusion|flux|imagen|midjourney)/i.test(m.name)) modality = 'image';
      else if (/^(tts|whisper|hifi-gan)/i.test(m.name)) modality = 'audio';

      models.push({
        platform,
        modelId: m.name,
        displayName: m.name,
        intelligenceRank: 0,
        speedRank: 0,
        sizeLabel: '',
        limits,
        monthlyTokenBudget: null,
        contextWindow,
        enabled: true,
        supportsVision: false,
        supportsTools: false,
        modality,
        mediaNote: m.notes || undefined,
      });
    }
  }

  return { models, version };
}

// ---- Ranking enrichment from the original catalog ----

async function fetchRankingEnrichment(): Promise<{
  rankings: Map<string, RankingValue>;
  quirks: CatalogQuirk[];
}> {
  const rankings = new Map<string, RankingValue>();
  const quirks: CatalogQuirk[] = [];

  try {
    const applied = getSetting(SETTING_APPLIED_VERSION);
    const url = new URL(`${catalogBaseUrl()}/v1/latest`);
    if (applied) url.searchParams.set('since', applied);

    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

    if (res.status === 304) return { rankings, quirks };
    if (!res.ok) throw new Error(`ranking catalog fetch failed: HTTP ${res.status}`);

    const signature = res.headers.get('x-catalog-signature');
    if (!signature) throw new Error('ranking catalog response missing signature');
    const bytes = Buffer.from(await res.arrayBuffer());
    const verified = crypto.verify(null, bytes, catalogPublicKey(), Buffer.from(signature, 'base64'));
    if (!verified) throw new Error('ranking catalog signature verification FAILED');

    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    if (!isCatalog(parsed)) throw new Error('ranking catalog payload has unexpected shape');
    const catalog = parsed;

    if (catalog.version < MIN_RANKING_VERSION) {
      return { rankings, quirks }; // Too old, skip enrichment
    }

    for (const m of catalog.models) {
      const key = `${m.platform}:${m.modelId}`;
      rankings.set(key, {
        intelligenceRank: m.intelligenceRank,
        speedRank: m.speedRank,
        sizeLabel: m.sizeLabel,
        limits: m.limits,
        monthlyTokenBudget: m.monthlyTokenBudget,
        contextWindow: m.contextWindow,
        supportsVision: m.supportsVision,
        supportsTools: m.supportsTools,
      });
    }

    quirks.push(...catalog.quirks);
  } catch (err) {
    // Non-fatal — ranking is just enrichment
    console.warn(`[catalog-sync] ranking enrichment unavailable: ${err instanceof Error ? err.message : err}`);
  }

  return { rankings, quirks };
}

/**
 * Merge ranking data into the yangmao-derived model list.
 * Fields from the original catalog override yangmao defaults.
 */
function mergeRankings(yangmaoModels: CatalogModel[], rankings: Map<string, RankingValue>): CatalogModel[] {
  return yangmaoModels.map((m) => {
    const key = `${m.platform}:${m.modelId}`;
    const r = rankings.get(key);
    if (!r) return m;
    return {
      ...m,
      intelligenceRank: r.intelligenceRank,
      speedRank: r.speedRank,
      sizeLabel: r.sizeLabel,
      limits: r.limits,
      monthlyTokenBudget: r.monthlyTokenBudget,
      contextWindow: r.contextWindow ?? m.contextWindow,
      supportsVision: r.supportsVision,
      supportsTools: r.supportsTools,
    };
  });
}

// ---- applyCatalog (unchanged write path) ----

/**
 * Apply a verified catalog to the local DB inside one transaction.
 *
 * Rules of engagement with user data:
 *  - metadata (name, ranks, limits, context, capabilities) always tracks the
 *    catalog — that is the whole point of the product;
 *  - catalog enabled=false force-disables (the model is dead upstream), but
 *    enabled=true never re-enables a model the user turned off themselves;
 *  - models the user added via custom providers (platform='custom' or bound to
 *    a key) are never touched;
 *  - models that vanished from the catalog are deleted, exactly like the
 *    dead-model migrations do (fallback_config row first, FK order).
 */
export function applyCatalog(db: DatabaseType.Database, catalog: Catalog): NonNullable<SyncResult['counts']> {
  const counts = { updated: 0, inserted: 0, removed: 0, skippedUnknownPlatform: 0, quirks: 0 };

  const selectModel = db.prepare('SELECT id, enabled FROM models WHERE platform = ? AND model_id = ?');
  const updateModel = db.prepare(`
    UPDATE models SET
      display_name = @displayName, intelligence_rank = @intelligenceRank, speed_rank = @speedRank,
      size_label = @sizeLabel, rpm_limit = @rpm, rpd_limit = @rpd, tpm_limit = @tpm, tpd_limit = @tpd,
      monthly_token_budget = @monthlyTokenBudget, context_window = @contextWindow,
      supports_vision = @supportsVision, supports_tools = @supportsTools,
      enabled = @enabled
    WHERE id = @id
  `);
  const insertModel = db.prepare(`
    INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, size_label,
                        rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window,
                        enabled, supports_vision, supports_tools)
    VALUES (@platform, @modelId, @displayName, @intelligenceRank, @speedRank, @sizeLabel,
            @rpm, @rpd, @tpm, @tpd, @monthlyTokenBudget, @contextWindow,
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
      const modality = m.modality ?? 'text';
      if (MEDIA_MODALITIES.has(modality)) {
        if (!MEDIA_PLATFORMS.has(m.platform)) {
          counts.skippedUnknownPlatform++;
          continue;
        }
        inMediaCatalog.add(`${m.platform}:${m.modelId}`);
        const mrow = selectMedia.get(m.platform, m.modelId) as { id: number; enabled: number } | undefined;
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
          insertMedia.run({ ...mfields, platform: m.platform, modelId: m.modelId, enabled: m.enabled ? 1 : 0 });
          counts.inserted++;
        }
        continue;
      }

      if (m.platform === 'custom' || !hasProvider(m.platform as Platform)) {
        counts.skippedUnknownPlatform++;
        continue;
      }
      inCatalog.add(`${m.platform}:${m.modelId}`);

      const row = selectModel.get(m.platform, m.modelId) as { id: number; enabled: number } | undefined;
      const fields = {
        displayName: m.displayName,
        intelligenceRank: m.intelligenceRank,
        speedRank: m.speedRank,
        sizeLabel: m.sizeLabel,
        rpm: m.limits.rpm,
        rpd: m.limits.rpd,
        tpm: m.limits.tpm,
        tpd: m.limits.tpd,
        monthlyTokenBudget: m.monthlyTokenBudget,
        contextWindow: m.contextWindow,
        supportsVision: m.supportsVision ? 1 : 0,
        supportsTools: m.supportsTools ? 1 : 0,
      };
      if (row) {
        const enabled = m.enabled ? row.enabled : 0;
        updateModel.run({ ...fields, id: row.id, enabled });
        counts.updated++;
      } else {
        insertModel.run({ ...fields, platform: m.platform, modelId: m.modelId, enabled: m.enabled ? 1 : 0 });
        counts.inserted++;
      }
    }

    // Ensure every model has a fallback_config row
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
      .prepare(`SELECT id, platform, model_id FROM models WHERE platform != 'custom' AND key_id IS NULL`)
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

// ---- Sync orchestration ----

/**
 * Main sync: fetch yangmao data (primary), enrich with rankings from the
 * original catalog (secondary, non-fatal), then apply the merged result.
 */
export async function syncCatalog(): Promise<SyncResult> {
  const db = getDb();

  try {
    // 1. Fetch yangmao data (primary)
    const { models: yangmaoModels, version } = await fetchYangmaoData();
    const applied = getSetting(SETTING_APPLIED_VERSION);

    // 2. Fetch ranking enrichment (secondary, non-fatal)
    const { rankings, quirks } = await fetchRankingEnrichment();

    // 3. Merge rankings onto yangmao models
    const mergedModels = mergeRankings(yangmaoModels, rankings);

    // 4. Build the catalog object for applyCatalog
    const catalog: Catalog = {
      version,
      generatedAt: new Date().toISOString(),
      tier: 'live',
      models: mergedModels,
      quirks,
    };

    // 5. Check if same version already applied
    if (applied === version) {
      setSetting(SETTING_LAST_SYNC_MS, String(Date.now()));
      setSetting(SETTING_LAST_ERROR, '');
      return { ok: true, action: 'up_to_date', version };
    }

    // 6. Apply
    const counts = applyCatalog(db, catalog);
    setSetting(SETTING_APPLIED_VERSION, version);
    setSetting(SETTING_APPLIED_JSON, JSON.stringify(catalog));

    console.log(
      `[catalog-sync] applied yangmao v${version}: ` +
        `${counts.updated} updated, ${counts.inserted} new, ${counts.removed} removed, ` +
        `${counts.quirks} quirks in catalog` +
        (counts.skippedUnknownPlatform ? `, ${counts.skippedUnknownPlatform} skipped (unknown platform)` : ''),
    );

    setSetting(SETTING_LAST_SYNC_MS, String(Date.now()));
    setSetting(SETTING_LAST_ERROR, '');
    return { ok: true, action: 'applied', version, counts };
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
    baseUrl: YANGMAO_URL,
    appliedVersion: getSetting(SETTING_APPLIED_VERSION) ?? null,
    lastSyncMs: Number(getSetting(SETTING_LAST_SYNC_MS)) || null,
    lastError: getSetting(SETTING_LAST_ERROR) || null,
  };
}

/**
 * Re-apply the cached (already applied) merged catalog after boot.
 *
 * On every boot the migrations re-assert the bundled baseline (INSERT OR
 * IGNORE), which would re-add the yangmao-deleted models and drift the DB
 * away from the last sync. Re-applying from the local cache is synchronous,
 * needs no network, and keeps the catalog authoritative even offline.
 */
export function reapplyCachedCatalog(): { reapplied: boolean; version?: string } {
  try {
    const raw = getSetting(SETTING_APPLIED_JSON);
    if (!raw) return { reapplied: false };
    const parsed: unknown = JSON.parse(raw);
    if (!isCatalog(parsed)) return { reapplied: false };
    applyCatalog(getDb(), parsed);
    console.log(`[catalog-sync] re-applied cached yangmao v${parsed.version} after boot`);
    return { reapplied: true, version: parsed.version };
  } catch (err) {
    console.warn(`[catalog-sync] cached catalog re-apply failed: ${err instanceof Error ? err.message : err}`);
    return { reapplied: false };
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;
let bootTimer: ReturnType<typeof setTimeout> | null = null;

export function startCatalogSync(): void {
  if (intervalId) return;
  if (process.env.CATALOG_SYNC_DISABLED === '1') {
    console.log('[catalog-sync] disabled via CATALOG_SYNC_DISABLED=1');
    return;
  }
  reapplyCachedCatalog();
  const run = () => {
    void syncCatalog();
  };
  bootTimer = setTimeout(run, BOOT_DELAY_MS);
  intervalId = setInterval(run, SYNC_INTERVAL_MS);
  console.log(`[catalog-sync] polling ${YANGMAO_URL} every ${SYNC_INTERVAL_MS / 3600000}h`);
}

export function stopCatalogSync(): void {
  if (bootTimer) {
    clearTimeout(bootTimer);
    bootTimer = null;
  }
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
