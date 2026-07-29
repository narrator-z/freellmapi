import crypto from 'crypto';
import type { Db } from '../db/types.js';
import { getDb, setSetting, getSetting } from '../db/index.js';
import { hasProvider, registerFromCatalog, YANGMAO_PLATFORM_ALIASES, type CatalogPlatform } from '../providers/index.js';
import { googleStudioApiModelId } from '../providers/google.js';
import { MEDIA_PLATFORMS, TRANSCRIPTION_PLATFORMS } from './media.js';
import { EMBEDDING_PLATFORMS } from './embeddings.js';
import type { Platform } from '@freellmapi/shared/types.js';
import type { Scheduler } from '../lib/scheduler.js';
import {
  applyAllModelOverrides,
  applyModelOverrides,
  deleteTombstonedCatalogModels,
  isCatalogModelTombstoned,
} from './model-state.js';
import { ensureAllModelsInProfiles } from './profile-models.js';

// ========================================================================
// catalog-sync — keeps the local model catalog in step with published data.
//
// Data source (single authoritative source):
//   freellmapi-augmented — a static JSON catalog containing the merged
//   v1 catalog data + yangmao.ai free-tier coverage, with intelligence/
//   speed rankings, quirks, and metadata.
//   Refreshed by the upstream CI; synced here every 12 hours.
//
// Optional: set CATALOG_BASE_URL to a signed catalog API endpoint for
// Ed25519-verified fetches (no license key required).
// ========================================================================

const AUGMENTED_CATALOG_URL = process.env.AUGMENTED_CATALOG_URL ??
  'https://git.260123.xyz/narrator-z/freellmapi-augmented/raw/branch/main/output/augmented_catalog.json';

const SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000; // twice daily
const BOOT_DELAY_MS = 10 * 1000;
const FETCH_TIMEOUT_MS = 20 * 1000;

// yangmao-* platforms in the augmented catalog are passthrough wrappers that
// map to real providers. YANGMAO_PLATFORM_ALIASES (imported from
// providers/index.ts) remaps them so models get stored under the correct
// platform and pass the hasProvider() check; registerFromCatalog uses the
// same map to auto-register the targets.

// Generative-media modalities are routed into the separate media_models table
// (see services/media.ts), never into the chat `models` table.
const MEDIA_MODALITIES = new Set(['image', 'audio']);

// settings table keys
const SETTING_APPLIED_VERSION = 'augmented_catalog_applied_version';
const SETTING_APPLIED_TIER = 'augmented_catalog_applied_tier';
const SETTING_APPLIED_JSON = 'augmented_catalog_applied_json';
const SETTING_LAST_SYNC_MS = 'augmented_catalog_last_sync_ms';
const SETTING_LAST_ERROR = 'augmented_catalog_last_error';

// ---- Catalog data types (wire format of the augmented catalog) ----

export interface AugmentedCatalogModel {
  platform: string;
  modelId: string;
  /** Provider-API-callable id, present when modelId is a human display name.
   * Preferred over modelId when set (contract: pipeline emits this since
   * 2026-07-27); absent = fall back to modelId (backward compatible). */
  apiModelId?: string;
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

interface CatalogEmbedding {
  family: string;
  platform: string;
  modelId: string;
  displayName: string;
  dimensions: number;
  maxInputTokens: number | null;
  priority: number;
  enabled: boolean;
  quotaLabel: string;
}

interface CatalogTranscriptionModel {
  platform: string;
  modelId: string;
  displayName: string;
  /** Failover order within the STT chain, lower first. */
  priority: number;
  enabled: boolean;
  /** Subtitle formats the provider returns natively (e.g. ['vtt']). */
  subtitleFormats?: string[];
  /** Provider upload ceiling in bytes; absent = the route-wide 25 MB cap. */
  maxBytes?: number | null;
  /** Adapter request flavor where one platform hosts more than one deployment
   *  style (cloudflare: 'json' = base64 JSON body, 'binary' = raw bytes). */
  requestStyle?: string | null;
  /** Short display note, mirrored into media_models.quota_label. */
  quotaLabel?: string;
}

interface AugmentedCatalog {
  version: string;
  generatedAt: string;
  tier?: string;
  platforms?: CatalogPlatform[];
  models: AugmentedCatalogModel[];
  /** Optional for backward compatibility with catalogs published before the
   * embedding registry joined the signed freshness feed. */
  embeddings?: CatalogEmbedding[];
  /** Speech-to-text registry, landing in media_models with
   * modality='transcription'. Deliberately a NEW top-level key rather than
   * more `models` entries: deployed binaries that predate the transcription
   * modality would ingest unknown-modality `models` entries as CHAT models,
   * while an unknown optional key is simply ignored by their isCatalog. */
  transcriptionModels?: CatalogTranscriptionModel[];
  quirks: CatalogQuirk[];
  counts?: { platforms: number; models: number; enabledModels: number; quirks: number; baseModelsCount: number };
}

export interface AugmentedSyncResult {
  ok: boolean;
  action: 'applied' | 'up_to_date' | 'skipped_older' | 'error';
  version?: string;
  tier?: string;
  detail?: string;
  counts?: { updated: number; inserted: number; removed: number; skippedUnknownPlatform: number; quirks: number };
}

export interface AugmentedCatalogSyncState {
  baseUrl: string;
  appliedVersion: string | null;
  appliedTier: string | null;
  lastSyncMs: number | null;
  lastError: string | null;
}

// ---- Helpers ----

/** Minimal structural check for the augmented catalog. */
function isAugmentedCatalog(value: unknown): value is AugmentedCatalog {
  const c = value as AugmentedCatalog;
  return (
    !!c &&
    typeof c.version === 'string' &&
    typeof c.generatedAt === 'string' &&
    Array.isArray(c.models) &&
    Array.isArray(c.quirks) &&
    (c.embeddings === undefined ||
      (Array.isArray(c.embeddings) &&
        c.embeddings.every(
          (m) =>
            typeof m?.family === 'string' &&
            typeof m?.platform === 'string' &&
            typeof m?.modelId === 'string' &&
            typeof m?.displayName === 'string' &&
            typeof m?.dimensions === 'number' &&
            typeof m?.priority === 'number' &&
            typeof m?.enabled === 'boolean',
        ))) &&
    (c.transcriptionModels === undefined ||
      (Array.isArray(c.transcriptionModels) &&
        c.transcriptionModels.every(
          (m) =>
            typeof m?.platform === 'string' &&
            typeof m?.modelId === 'string' &&
            typeof m?.displayName === 'string' &&
            typeof m?.priority === 'number' &&
            typeof m?.enabled === 'boolean' &&
            (m.subtitleFormats === undefined ||
              (Array.isArray(m.subtitleFormats) && m.subtitleFormats.every((f) => typeof f === 'string'))) &&
            (m.maxBytes === undefined || m.maxBytes === null || typeof m.maxBytes === 'number') &&
            (m.requestStyle === undefined || m.requestStyle === null || typeof m.requestStyle === 'string'),
        ))) &&
    c.models.every(
      (m) =>
        typeof m?.platform === 'string' &&
        typeof m?.modelId === 'string' &&
        (m.apiModelId === undefined || typeof m.apiModelId === 'string') &&
        typeof m?.displayName === 'string' &&
        typeof m?.enabled === 'boolean' &&
        !!m?.limits &&
        typeof m.limits === 'object',
    ) &&
    c.quirks.every((q) => typeof q?.slug === 'string' && Array.isArray(q?.targets))
  );
}

// ---- Fetch the augmented catalog ----

async function fetchAugmentedCatalog(): Promise<AugmentedCatalog> {
  const res = await fetch(AUGMENTED_CATALOG_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

  if (!res.ok) throw new Error(`augmented catalog fetch failed: HTTP ${res.status}`);

  const bytes = Buffer.from(await res.arrayBuffer());
  const parsed: unknown = JSON.parse(bytes.toString('utf8'));
  if (!isAugmentedCatalog(parsed)) throw new Error('augmented catalog payload has unexpected shape');
  return parsed;
}

function routableContextWindow(platform: string, modelId: string, contextWindow: number | null): number | null {
  if (platform === 'github' && modelId === 'openai/gpt-4.1') return 8000;
  return contextWindow;
}

// Known junk rows from the v1 (cheahjs) source: section headers and label
// lines that ended up in the models array but are not callable models.
// The pipeline now filters these at parse time (contract §8.2); this set is
// only a last-resort fallback for older published/cached catalogs. Both the
// legacy shadow-platform key and the canonical-platform key are listed.
const CATALOG_MODEL_JUNK = new Set([
  'mistral-la-plateforme:Open and Proprietary Mistral models',
  'mistral:Open and Proprietary Mistral models',
]);

// Model ids the provider can actually call. Since 2026-07-27 the pipeline
// emits `apiModelId` for every catalog entry whose modelId is a human display
// name (contract §8.1: groq/google/openrouter/yangmao mappings now live
// upstream in reference/api_model_map.json) — prefer it. The old hardcoded
// groq DISPLAY_NAME_ID_OVERRIDES table is removed; for catalogs published
// before the field existed, fall back to the generic google slugger (the
// Gemini API needs the slugged id in the URL path) and finally to modelId.
function routableModelId(platform: string, m: AugmentedCatalogModel): string {
  if (typeof m.apiModelId === 'string' && m.apiModelId.length > 0) return m.apiModelId;
  if (platform === 'google-ai-studio' || platform === 'google') return googleStudioApiModelId(m.modelId);
  return m.modelId;
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
 *  - rows the user created (models.source = 'user': custom providers,
 *    declarative config, admin adds) are never updated, never deleted, and
 *    never adopted — on a platform:model_id collision the user row wins and
 *    the catalog entry is skipped outright;
 *  - catalog models the user deleted stay deleted via tombstones;
 *  - models that vanished from the catalog are deleted, exactly like the
 *    dead-model migrations do (fallback_config row first, FK order).
 */
export function applyAugmentedCatalog(db: Db, catalog: AugmentedCatalog): NonNullable<AugmentedSyncResult['counts']> {
  const counts = { updated: 0, inserted: 0, removed: 0, skippedUnknownPlatform: 0, quirks: 0 };

  const selectModel = db.prepare('SELECT id, enabled, source FROM models WHERE platform = ? AND model_id = ?');
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
                        enabled, supports_vision, supports_tools, source)
    VALUES (@platform, @modelId, @displayName,
            COALESCE(@intelligenceRank, 50), COALESCE(@speedRank, 50), COALESCE(@sizeLabel, 'Medium'),
            @rpm, @rpd, @tpm, @tpd, COALESCE(@monthlyTokenBudget, ''), @contextWindow,
            @enabled, @supportsVision, @supportsTools, 'catalog')
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
  // Transcription rows share media_models but carry adapter metadata in
  // meta_json (subtitle capability, upload ceiling, request flavor).
  const updateTranscription = db.prepare(`
    UPDATE media_models SET
      display_name = @displayName, modality = 'transcription', priority = @priority,
      quota_label = @quotaLabel, enabled = @enabled, meta_json = @metaJson
    WHERE id = @id
  `);
  const insertTranscription = db.prepare(`
    INSERT INTO media_models (platform, model_id, display_name, modality, priority, enabled, quota_label, meta_json)
    VALUES (@platform, @modelId, @displayName, 'transcription', @priority, @enabled, @quotaLabel, @metaJson)
  `);
  const selectEmbedding = db.prepare(
    'SELECT id, enabled FROM embedding_models WHERE platform = ? AND model_id = ?',
  );
  const updateEmbedding = db.prepare(`
    UPDATE embedding_models SET
      family = @family, display_name = @displayName, dimensions = @dimensions,
      max_input_tokens = @maxInputTokens, priority = @priority,
      quota_label = @quotaLabel, enabled = @enabled
    WHERE id = @id
  `);
  const insertEmbedding = db.prepare(`
    INSERT INTO embedding_models
      (family, platform, model_id, display_name, dimensions, max_input_tokens,
       priority, enabled, quota_label)
    VALUES
      (@family, @platform, @modelId, @displayName, @dimensions, @maxInputTokens,
       @priority, @enabled, @quotaLabel)
  `);

  const apply = db.transaction(() => {
    const inCatalog = new Set<string>();
    const inMediaCatalog = new Set<string>();
    const inEmbeddingCatalog = new Set<string>();
    const inTranscriptionCatalog = new Set<string>();

    for (const m of catalog.models) {
      // Remap yangmao-* wrapper platforms to their real provider.
      let platform = YANGMAO_PLATFORM_ALIASES[m.platform] ?? m.platform;
      // v1-lineage shadow platforms retired upstream (contract 2026-07-27):
      // google-ai-studio is the same native Gemini backend as 'google', and
      // mistral-la-plateforme is the same OpenAI-compatible endpoint as
      // 'mistral'. Remap so their models stay routable without registering a
      // separate provider (and without diverging the shared Platform union).
      if (platform === 'google-ai-studio') platform = 'google';
      if (platform === 'mistral-la-plateforme') platform = 'mistral';
      // Known junk rows from the v1 (cheahjs) source: section headers and
      // label lines that are not callable models.
      if (CATALOG_MODEL_JUNK.has(`${platform}:${m.modelId}`)) {
        counts.skippedUnknownPlatform++;
        continue;
      }
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
      // The pipeline emits apiModelId for display-name entries; resolve the
      // routable id once (apiModelId > google slug fallback > modelId) and
      // use it for every DB key below.
      const modelId = routableModelId(platform, m);
      if (isCatalogModelTombstoned(db, 'chat', platform, modelId)) continue;
      inCatalog.add(`${platform}:${modelId}`);

      const row = selectModel.get(platform, modelId) as
        | { id: number; enabled: number; source: string }
        | undefined;
      // Collision rule: if the user hand-added a model and the catalog later
      // ships the same platform:model_id, the user row wins — the catalog
      // neither clobbers its metadata nor adopts it (same spirit as the
      // never-touch rule for custom-provider models). The row also survives
      // the prune below because the delete pass only considers source='catalog'.
      if (row && row.source === 'user') continue;
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
        applyModelOverrides(db, platform, modelId);
        counts.updated++;
      } else {
        insertModel.run({ ...fields, platform, modelId, enabled: m.enabled ? 1 : 0 });
        applyModelOverrides(db, platform, modelId);
        counts.inserted++;
      }
    }

    // Embeddings are their own full snapshot. Older catalogs omit this field;
    // in that case retain the app's bundled embedding baseline untouched.
    if (catalog.embeddings) {
      for (const m of catalog.embeddings) {
        if (!EMBEDDING_PLATFORMS.has(m.platform)) {
          counts.skippedUnknownPlatform++;
          continue;
        }
        inEmbeddingCatalog.add(`${m.platform}:${m.modelId}`);
        const row = selectEmbedding.get(m.platform, m.modelId) as { id: number; enabled: number } | undefined;
        const fields = {
          family: m.family,
          displayName: m.displayName,
          dimensions: m.dimensions,
          maxInputTokens: m.maxInputTokens,
          priority: m.priority,
          quotaLabel: m.quotaLabel,
        };
        if (row) {
          const enabled = m.enabled ? row.enabled : 0; // catalog and local disables both win
          updateEmbedding.run({ ...fields, id: row.id, enabled });
          counts.updated++;
        } else {
          insertEmbedding.run({
            ...fields,
            platform: m.platform,
            modelId: m.modelId,
            enabled: m.enabled ? 1 : 0,
          });
          counts.inserted++;
        }
      }
    }

    // Transcription models are their own full snapshot, routed into
    // media_models with modality='transcription' and gated on
    // TRANSCRIPTION_PLATFORMS the way MEDIA_PLATFORMS gates the generative
    // rows. Older catalogs omit this key; keep existing rows untouched then.
    if (catalog.transcriptionModels) {
      for (const m of catalog.transcriptionModels) {
        if (!TRANSCRIPTION_PLATFORMS.has(m.platform)) {
          counts.skippedUnknownPlatform++;
          continue;
        }
        if (isCatalogModelTombstoned(db, 'media', m.platform, m.modelId)) continue;
        inTranscriptionCatalog.add(`${m.platform}:${m.modelId}`);
        const meta: Record<string, unknown> = {};
        if (m.subtitleFormats?.length) meta.subtitleFormats = m.subtitleFormats;
        if (typeof m.maxBytes === 'number') meta.maxBytes = m.maxBytes;
        if (typeof m.requestStyle === 'string') meta.requestStyle = m.requestStyle;
        const fields = {
          displayName: m.displayName,
          priority: m.priority,
          quotaLabel: m.quotaLabel ?? '',
          metaJson: Object.keys(meta).length > 0 ? JSON.stringify(meta) : null,
        };
        const row = selectMedia.get(m.platform, m.modelId) as { id: number; enabled: number } | undefined;
        if (row) {
          const enabled = m.enabled ? row.enabled : 0; // catalog and local disables both win
          updateTranscription.run({ ...fields, id: row.id, enabled });
          counts.updated++;
        } else {
          insertTranscription.run({ ...fields, platform: m.platform, modelId: m.modelId, enabled: m.enabled ? 1 : 0 });
          counts.inserted++;
        }
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
    ensureAllModelsInProfiles(db);

    // Remove catalog-managed models that the catalog no longer lists.
    // Ownership is decided by the `source` provenance column: only rows the
    // catalog itself created are prune candidates. Rows with source='user'
    // (declarative config, admin adds, custom endpoints) are never deleted
    // here, no matter what their size_label or platform says — that replaces
    // the old size_label NOT IN ('User','Custom') heuristic, which lost user
    // rows whose label didn't follow the convention. The platform/key_id
    // predicates stay as belt and braces.
    const candidates = db
      .prepare(`
        SELECT id, platform, model_id
          FROM models
         WHERE platform != 'custom'
           AND key_id IS NULL
           AND source = 'catalog'
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

    // Remove media models the catalog no longer lists (own table, no
    // fallback_config). Scoped to the generative modalities: transcription
    // rows are maintained by the `transcriptionModels` snapshot below, and
    // must survive here even when its key is absent from an older catalog.
    const mediaCandidates = db
      .prepare("SELECT id, platform, model_id FROM media_models WHERE modality != 'transcription'")
      .all() as { id: number; platform: string; model_id: string }[];
    const deleteMedia = db.prepare('DELETE FROM media_models WHERE id = ?');
    for (const c of mediaCandidates) {
      if (!MEDIA_PLATFORMS.has(c.platform)) continue;
      if (!inMediaCatalog.has(`${c.platform}:${c.model_id}`)) {
        deleteMedia.run(c.id);
        counts.removed++;
      }
    }

    // Prune transcription rows only when the catalog actually carries the
    // snapshot (mirrors the embeddings rule), scoped to the modality so
    // image/audio rows are never touched by it.
    if (catalog.transcriptionModels) {
      const sttCandidates = db
        .prepare("SELECT id, platform, model_id FROM media_models WHERE modality = 'transcription'")
        .all() as { id: number; platform: string; model_id: string }[];
      for (const c of sttCandidates) {
        if (!TRANSCRIPTION_PLATFORMS.has(c.platform)) continue;
        if (!inTranscriptionCatalog.has(`${c.platform}:${c.model_id}`)) {
          deleteMedia.run(c.id);
          counts.removed++;
        }
      }
    }

    if (catalog.embeddings) {
      const embeddingCandidates = db
        .prepare(`
          SELECT id, platform, model_id
            FROM embedding_models
           WHERE platform != 'custom' AND key_id IS NULL
        `)
        .all() as { id: number; platform: string; model_id: string }[];
      const deleteEmbedding = db.prepare('DELETE FROM embedding_models WHERE id = ?');
      for (const c of embeddingCandidates) {
        if (!EMBEDDING_PLATFORMS.has(c.platform)) continue;
        if (!inEmbeddingCatalog.has(`${c.platform}:${c.model_id}`)) {
          deleteEmbedding.run(c.id);
          counts.removed++;
        }
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

export const AUGMENTED_MIN_CATALOG_VERSION = '2026.06.07';

/**
 * Main sync: fetch the augmented catalog and apply it.
 *
 * The augmented catalog is a pre-merged file containing both the v1 catalog
 * (with full rankings and quirks) and yangmao.ai free-tier coverage.
 * No merge step needed — data is applied directly.
 */
export async function syncAugmentedCatalog(): Promise<AugmentedSyncResult> {
  const db = getDb();

  try {
    const catalog = await fetchAugmentedCatalog();

    // Register any new providers from the catalog before applying models,
    // so their models can pass the hasProvider() gate in applyAugmentedCatalog().
    // Hand-maintained providers are never overwritten.
    const regResult = registerFromCatalog(catalog.platforms ?? []);
    if (regResult.added.length > 0) {
      console.log(`[augmented-catalog-sync] auto-registered ${regResult.added.length} new provider(s): ${regResult.added.join(', ')}`);
    }
    if (regResult.conflicts.length > 0) {
      console.warn(`[augmented-catalog-sync] failed to register ${regResult.conflicts.length} provider(s): ${regResult.conflicts.join(', ')}`);
    }

    const counts = applyAugmentedCatalog(db, catalog);
    setSetting(SETTING_APPLIED_VERSION, catalog.version);
    setSetting(SETTING_APPLIED_JSON, JSON.stringify(catalog));
    if (catalog.tier) {
      setSetting(SETTING_APPLIED_TIER, catalog.tier);
    }

    console.log(
      `[augmented-catalog-sync] applied augmented v${catalog.version}: ` +
        `${counts.updated} updated, ${counts.inserted} new, ${counts.removed} removed, ` +
        `${counts.quirks} quirks` +
        (counts.skippedUnknownPlatform ? `, ${counts.skippedUnknownPlatform} skipped (unknown platform)` : ''),
    );

    setSetting(SETTING_LAST_SYNC_MS, String(Date.now()));
    setSetting(SETTING_LAST_ERROR, '');
    return { ok: true, action: 'applied', version: catalog.version, tier: catalog.tier, counts };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[augmented-catalog-sync] ${message}`);
    setSetting(SETTING_LAST_ERROR, message);
    return { ok: false, action: 'error', detail: message };
  }
}

// ---- Cache & lifecycle ----

export function getAugmentedSyncState(): AugmentedCatalogSyncState {
  return {
    baseUrl: AUGMENTED_CATALOG_URL,
    appliedVersion: getSetting(SETTING_APPLIED_VERSION) ?? null,
    appliedTier: getSetting(SETTING_APPLIED_TIER) ?? null,
    lastSyncMs: Number(getSetting(SETTING_LAST_SYNC_MS)) || null,
    lastError: getSetting(SETTING_LAST_ERROR) || null,
  };
}

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
export function reapplyCachedAugmentedCatalog(): { reapplied: boolean; version?: string } {
  try {
    const raw = getSetting(SETTING_APPLIED_JSON);
    if (!raw) {
      if (getSetting(SETTING_APPLIED_VERSION)) {
        getDb().prepare('DELETE FROM settings WHERE key = ?').run(SETTING_APPLIED_VERSION);
      }
      return { reapplied: false };
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isAugmentedCatalog(parsed)) return { reapplied: false };
    // Reject cached catalogs older than the bundled baseline — applying an
    // old snapshot would roll back models that a newer app version added via
    // migrations.
    if (parsed.version < AUGMENTED_MIN_CATALOG_VERSION) return { reapplied: false };
    // Old caches (schemaVersion < 3) have a different structure — discard.
    const record = parsed as unknown as Record<string, unknown>;
    if (record.schemaVersion && (record.schemaVersion as number) < 3) {
      console.log(`[augmented-catalog-sync] discarding old-format cache (schemaVersion ${record.schemaVersion})`);
      getDb().prepare('DELETE FROM settings WHERE key = ? OR key = ?').run('augmented_catalog_applied_version', 'augmented_catalog_applied_json');
      return { reapplied: false };
    }

    // Backfill schemaVersion for caches that predate this field.
    if (!record.schemaVersion) {
      record.schemaVersion = 3;
      setSetting(SETTING_APPLIED_JSON, JSON.stringify(record));
    }
    applyAugmentedCatalog(getDb(), parsed as AugmentedCatalog);
    console.log(`[augmented-catalog-sync] re-applied cached augmented catalog v${(parsed as AugmentedCatalog).version} after boot`);
    return { reapplied: true, version: (parsed as AugmentedCatalog).version };
  } catch (err) {
    console.warn(`[augmented-catalog-sync] cached catalog re-apply failed: ${err instanceof Error ? err.message : err}`);
    return { reapplied: false };
  }
}

let cancelBootTimer: (() => void) | null = null;
let cancelInterval: (() => void) | null = null;

export function startAugmentedCatalogSync(scheduler: Scheduler): void {
  if (cancelInterval) return;
  if (process.env.CATALOG_SYNC_DISABLED === '1') {
    console.log('[augmented-catalog-sync] disabled via CATALOG_SYNC_DISABLED=1');
    return;
  }
  reapplyCachedAugmentedCatalog();
  const run = () => {
    void syncAugmentedCatalog();
  };
  cancelBootTimer = scheduler.after(BOOT_DELAY_MS, run);
  cancelInterval = scheduler.every(SYNC_INTERVAL_MS, run);
  console.log(`[augmented-catalog-sync] polling ${AUGMENTED_CATALOG_URL} every ${SYNC_INTERVAL_MS / 3600000}h`);
}

export function stopAugmentedCatalogSync(): void {
  if (cancelBootTimer) {
    cancelBootTimer();
    cancelBootTimer = null;
  }
  if (cancelInterval) {
    cancelInterval();
    cancelInterval = null;
  }
}
