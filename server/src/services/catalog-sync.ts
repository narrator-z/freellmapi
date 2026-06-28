import crypto from 'crypto';
import type DatabaseType from 'better-sqlite3';
import { getDb, setSetting, getSetting } from '../db/index.js';
import { hasProvider } from '../providers/index.js';
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
// Data sources (priority merge):
//   1. PRIMARY: api.freellmapi.co/v1/latest — curated model catalog with
//      intelligence/speed rankings, quirks, and metadata. Ed25519‑signed.
//      Always authoritative when available.
//   2. SUPPLEMENT: yangmao.ai/data/exports/ai-free-tiers.json — broad
//      coverage of free API providers. Added as extras only where v1 has
//      no matching model, so the curated v1 data is never overridden.
//
// Merge strategy:
//   - v1 data loads first and is authoritative (rankings, quirks, IDs)
//   - Yangmao supplements by adding models from v1-unknown platforms,
//     and adding models to known platforms that v1 doesn't list
//   - Yangmao models are matched to v1 by normalized display name to
//     avoid duplicates when the modelId formats differ
//   - When v1 updates, the new v1 takes precedence; yangmao re-supplements
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
const SETTING_V1_VERSION = 'catalog_v1_version';
const SETTING_YANGMA_VERSION = 'catalog_yangma_version';

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

export interface CatalogModel {
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
  api_free_credits?: string;
  models: YangmaoModel[];
}

interface YangmaoResponse {
  schema_version: string;
  generated_at: string;
  providers: YangmaoProvider[];
}

// Platform ID mappings between yangmao and internal providers.
// These map yangmao.ai provider IDs to the platform IDs used by the
// internal provider registry (providers/index.ts) and/or the v1 catalog.
const PLATFORM_ALIASES: Record<string, string> = {
  'nebius-ai-studio': 'nebius',
  'nvidia-build': 'nvidia',
  'gemini': 'google',              // yangmao "gemini" → internal "google"
  'github-models': 'github',       // yangmao "github-models" → internal "github"
  'yi': '01-ai',                   // yangmao "yi" → internal "01-ai"
};

// Reverse lookup: internal → yangmao ID.
const REVERSE_ALIASES: Record<string, string> = {};
for (const [k, v] of Object.entries(PLATFORM_ALIASES)) {
  REVERSE_ALIASES[v] = k;
}

// Mapping from yangmao platform IDs to v1/latest platform IDs.
// This is used during merge to match yangmao supplements against the v1 base,
// so yangmao models can be correctly attributed and deduplicated.
const YANGMAO_TO_V1_PLATFORM: Record<string, string> = {
  'nvidia-build': 'nvidia',
  'gemini': 'google',
  'github-models': 'github',
  'cloudflare-workers-ai': 'cloudflare', // v1 uses short platform ID
  'nebius-ai-studio': 'nebius',
};

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

export function parseContext(s: string): number | null {
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

export function parseRateLimit(s: string): { rpm: number | null; rpd: number | null; tpm: number | null; tpd: number | null } {
  const result = { rpm: null as number | null, rpd: null as number | null, tpm: null as number | null, tpd: null as number | null };
  if (!s) return result;

  const lowered = s.trim().toLowerCase();

  // Try patterns like "30 RPM", "50 RPD", "30 RPM / 60K TPM", "1000 RPD / 350K TPD"
  // Split on commas (full/half-width) or slash-separated spec pairs.
  // IMPORTANT: do NOT split on bare /day — that's a single rate unit, not a separator.
  // We first try to match "/day" as a single token, then split remaining parts on
  // commas and slashes-with-spaces-around.
  const parts: string[] = [];

  // Step 1: try to extract the "/day" pattern as a whole token from the raw string
  const dayGlobal = lowered.match(/\d+(?:\.\d+)?\s*\/?\s*(?:requests?|req|reqs?)?\s*\/?\s*day/);
  let remainder = lowered;
  if (dayGlobal) {
    parts.push(dayGlobal[0]);
    remainder = remainder.replace(dayGlobal[0], '').trim();
  }

  // Step 2: split the remainder on commas or slashes with surrounding whitespace
  const remainingParts = remainder.split(/\s*\/\s*|[,，、]/).map((p) => p.trim()).filter(Boolean);
  parts.push(...remainingParts);

  // Helper to parse an integer value that may include K/k suffix (e.g. "60K" → 60000)
  function parseCount(s: string): number {
    const kMatch = s.match(/^(\d+(?:\.\d+)?)\s*(k)?$/);
    if (!kMatch) return parseInt(s, 10);
    const base = parseFloat(kMatch[1]);
    return kMatch[2] ? Math.round(base * 1000) : Math.round(base);
  }

  for (const part of parts) {
    const p = part.trim().toLowerCase();
    // Match standard format: "10000/day" → rpd
    const dayMatch = p.match(/^(\d+(?:\.\d+)?)\s*\/?\s*(?:requests?|req|reqs?)?\s*\/?\s*day$/);
    if (dayMatch) {
      result.rpd = parseInt(dayMatch[1], 10);
      continue;
    }
    // Match standard format: "30 RPM", "60K TPM", etc.
    const m = p.match(/^(\d+(?:\.\d+)?)\s*(k|m)?\s*(rpm|rpd|tpm|tpd)$/);
    if (m) {
      const raw = parseFloat(m[1]);
      let val: number;
      if (m[2] === 'k') val = Math.round(raw * 1000);
      else if (m[2] === 'm') val = Math.round(raw * 1000000);
      else val = Math.round(raw);
      if (m[3] === 'rpm') result.rpm = val;
      else if (m[3] === 'rpd') result.rpd = val;
      else if (m[3] === 'tpm') result.tpm = val;
      else if (m[3] === 'tpd') result.tpd = val;
    }
  }
  return result;
}

// ---- V1 catalog fetch (primary source) ----

/**
 * Normalize a model display name for cross-source matching.
 * Strips parenthetical suffixes, whitespace, and common noise
 * so "Llama 3.3 70B Versatile" matches "Llama 3.3 70B".
 */
export function normalizeModelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, ' ')  // "(CF)", "(NV)", "(Ollama)" etc.
    .replace(/versatile|instruct|free|fast|fp8|it|beta|preview/gi, '')
    .replace(/[^a-z0-9.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fetch the authoritative v1 catalog from api.freellmapi.co/v1/latest. */
async function fetchV1Catalog(): Promise<Catalog> {
  const url = new URL(`${catalogBaseUrl()}/v1/latest`);
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

  if (!res.ok) throw new Error(`v1 catalog fetch failed: HTTP ${res.status}`);

  const signature = res.headers.get('x-catalog-signature');
  if (!signature) throw new Error('v1 catalog response missing signature');
  const bytes = Buffer.from(await res.arrayBuffer());
  const verified = crypto.verify(null, bytes, catalogPublicKey(), Buffer.from(signature, 'base64'));
  if (!verified) throw new Error('v1 catalog signature verification FAILED');

  const parsed: unknown = JSON.parse(bytes.toString('utf8'));
  if (!isCatalog(parsed)) throw new Error('v1 catalog payload has unexpected shape');
  return parsed;
}

// ---- Yangmao fetch & parse (supplement) ----

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

/**
 * Fetch yangmao.ai data and convert it to the /v1/latest Catalog format.
 *
 * Filter rule: only providers with `has_free_api: true` are included.
 * The `openai_compatible` flag is NOT checked here — applyCatalog drops
 * platforms that have no registered provider implementation, and some
 * registered providers (e.g. Cohere, ERNIE) report openai_compatible=false
 * in yangmao despite having working internal provider adapters.
 */
export async function fetchYangmaoData(): Promise<Catalog> {
  const res = await fetch(YANGMAO_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`yangmao fetch failed: HTTP ${res.status}`);

  const raw: unknown = await res.json();
  const body = raw as YangmaoResponse;
  if (!body || !body.providers || !body.generated_at) {
    throw new Error('yangmao payload has unexpected shape');
  }

  const version = body.generated_at;
  const models: CatalogModel[] = [];

  for (const p of body.providers) {
    // Only include providers that have a free API tier
    if (!p.has_free_api) continue;
    if (!p.models || p.models.length === 0) continue;

    const platform = PLATFORM_ALIASES[p.id] ?? p.id;

    for (const m of p.models) {
      // Skip entries that look like category descriptions rather than model names.
      const lowerName = m.name.trim().toLowerCase();
      if (/\b(routes?|compute|quota|fine-tuned|logging proxy|open-weight|and open)\b/.test(lowerName)) continue;
      if (!m.name.includes(' ') && !m.name.includes('-') && !m.name.includes('.') && m.name.length > 20) continue;
      const limits = parseRateLimit(m.rate_limit);
      const contextWindow = parseContext(m.context);

      // Heuristic: detect modality from model name keywords
      let modality: string | undefined;
      if (/^(dall-e|stable-diffusion|flux|imagen|midjourney)/i.test(m.name)) modality = 'image';
      else if (/^(tts|whisper|hifi-gan)/i.test(m.name)) modality = 'audio';

      const slugifiedId = toSlug(m.name);
      if (!slugifiedId) continue;

      // Heuristic: detect vision/tools from model name keywords
      const lower = lowerName;
      const supportsVision = /\b(vl|vision|multimodal|image)\b/i.test(lower);
      const supportsTools = !/\b(image|tts|whisper|embedding|rerank)\b/i.test(lower);

      models.push({
        platform,
        modelId: slugifiedId,
        displayName: m.name,
        intelligenceRank: 0,
        speedRank: 0,
        sizeLabel: '',
        limits,
        monthlyTokenBudget: p.api_free_credits || null,
        contextWindow,
        enabled: true,
        supportsVision,
        supportsTools,
        modality,
        mediaNote: m.notes || undefined,
      });
    }
  }

  return {
    version,
    generatedAt: body.generated_at,
    tier: 'live',
    models,
    quirks: [],
  };
}

// ---- Merge v1 (primary) + yangmao (supplement) ----

/**
 * Merge v1 catalog (primary) with yangmao supplements.
 *
 * Strategy:
 *   - v1 models are always kept with their original data (rankings, IDs, quirks)
 *   - Yangmao models are added only when they don't already exist in v1
 *   - For shared platforms: match by normalized display name to avoid duplicates
 *     when modelId formats differ (e.g. v1 "deepseek-ai/deepseek-v4-pro" vs
 *     yangmao slug "deepseek-v4-pro")
 *   - For yangmao-only platforms: all models are added
 *   - The merged catalog preserves v1's version/tier so future updates
 *     are compared against v1's version
 */
export function mergeCatalogs(v1: Catalog, yangmao: Catalog): Catalog {
  const mergedModels: CatalogModel[] = [...v1.models];

  // Track all v1 model keys for dedup
  const v1KeySet = new Set<string>();
  for (const m of v1.models) {
    v1KeySet.add(`${m.platform}:${m.modelId}`);
  }

  // Build v1 lookup by normalized display name per platform
  const v1ByName = new Map<string, Map<string, string>>();
  for (const m of v1.models) {
    let byName = v1ByName.get(m.platform);
    if (!byName) {
      byName = new Map();
      v1ByName.set(m.platform, byName);
    }
    byName.set(normalizeModelName(m.displayName), m.modelId);
  }

  for (const ym of yangmao.models) {
    // Map yangmao platform to v1 platform for merge matching
    const targetPlatform = YANGMAO_TO_V1_PLATFORM[ym.platform] ?? ym.platform;

    // Check by modelId key first
    const key = `${targetPlatform}:${ym.modelId}`;
    if (v1KeySet.has(key)) continue;

    // If platform exists in v1, check by normalized display name
    const v1Names = v1ByName.get(targetPlatform);
    if (v1Names) {
      const normName = normalizeModelName(ym.displayName);
      if (v1Names.has(normName)) continue;

      // Also try without the ym's modelId slug — some v1 models have
      // very different displayNames but represent the same model
      let matched = false;
      for (const [v1Norm, v1Mid] of v1Names) {
        // If one normalized name contains the other, they're likely the same model
        if ((normName.includes(v1Norm) || v1Norm.includes(normName)) && normName.length > 3 && v1Norm.length > 3) {
          matched = true;
          break;
        }
      }
      if (matched) continue;
    }

    // New model — add with correct platform
    mergedModels.push({
      ...ym,
      platform: targetPlatform,
    });
    v1KeySet.add(key);
  }

  return {
    version: v1.version,
    generatedAt: v1.generatedAt,
    tier: v1.tier,
    models: mergedModels,
    quirks: v1.quirks,
  };
}

/**
 * Convert a human-readable model name to a kebab-case URL slug, matching
 * the identifier format used by the ranking catalog.
 *   "Llama 3.3 70B Versatile"  →  "llama-3.3-70b-versatile"
 *   "Qwen2.5-Coder-32B-Instruct" → "qwen2.5-coder-32b-instruct"
 */
export function toSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[()]/g, '')              // strip parentheses
    .replace(/[@]/g, '')               // strip @ signs
    .replace(/[^a-z0-9._\s/:-]/g, '') // keep dot/underscore/slash/colon/hyphen
    .trim()
    .replace(/[\s_]+/g, '-')           // spaces & underscores → hyphens
    .replace(/[:/]/g, '-')             // colon & slash → hyphen
    .replace(/[^a-z0-9.-]/g, '')      // keep only alnum, dot, hyphen
    .replace(/-+/g, '-')               // collapse repeated hyphens
    .replace(/^-|-$/g, '')             // trim leading/trailing hyphens
    .replace(/\.\.+/g, '.');           // collapse repeated dots
}

// ---- applyCatalog (unchanged write path) ----

/**
 * Apply a verified catalog to the local DB inside one transaction.
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
        if (isCatalogModelTombstoned(db, 'media', m.platform, m.modelId)) continue;
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
      if (isCatalogModelTombstoned(db, 'chat', m.platform, m.modelId)) continue;
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
        applyModelOverrides(db, m.platform, m.modelId);
        counts.updated++;
      } else {
        insertModel.run({ ...fields, platform: m.platform, modelId: m.modelId, enabled: m.enabled ? 1 : 0 });
        applyModelOverrides(db, m.platform, m.modelId);
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

// ---- Legacy mergeRankings (kept for test backward compatibility) ----

/**
 * Merge ranking data into the yangmao-derived model list.
 * Fields from the original catalog override yangmao defaults.
 *
 * NOTE: The main sync flow no longer calls this directly — v1 data
 * (with full rankings) is the primary source; mergeCatalogs is used
 * instead. This function is kept for test backward compatibility.
 */
export function mergeRankings(yangmaoModels: CatalogModel[], rankings: Map<string, RankingValue>): CatalogModel[] {
  const rankingBySlug = new Map<string, RankingValue>();
  for (const [key, value] of rankings) {
    const slug = key.split('/').pop() ?? key;
    rankingBySlug.set(slug, value);
  }

  return yangmaoModels.map((m) => {
    const slug = toSlug(m.modelId);
    const altPlatform = REVERSE_ALIASES[m.platform];
    const r = rankings.get(`${m.platform}/${m.modelId}`)
      ?? (altPlatform ? rankings.get(`${altPlatform}/${m.modelId}`) : undefined)
      ?? rankingBySlug.get(`${m.platform}/${slug}`)
      ?? (altPlatform ? rankingBySlug.get(`${altPlatform}/${slug}`) : undefined)
      ?? rankingBySlug.get(slug);
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

// ---- Sync orchestration (v1 primary, yangmao supplement) ----

/**
 * Main sync: fetch v1 catalog (primary), supplement with yangmao models
 * that v1 doesn't have, then apply the merged result.
 *
 * Priority:
 *   1. v1/latest is authoritative — its models, rankings, and quirks
 *      are kept intact. Yangmao never overrides v1 data.
 *   2. Yangmao supplements by adding models that v1 doesn't list,
 *      either on new platforms or as additional models on known platforms.
 *   3. If v1 fetch fails (network/signature), falls back to yangmao-only.
 *   4. If yangmao also fails, the error is reported and no sync happens.
 */
export async function syncCatalog(): Promise<SyncResult> {
  const db = getDb();

  try {
    // 1. Fetch v1 catalog (primary — authoritative)
    let v1Catalog: Catalog | null = null;
    try {
      v1Catalog = await fetchV1Catalog();
    } catch (v1Err) {
      console.warn(`[catalog-sync] v1 catalog unavailable: ${v1Err instanceof Error ? v1Err.message : v1Err}`);
    }

    // 2. Fetch yangmao supplements (non-fatal)
    let yangmaoCatalog: Catalog | null = null;
    try {
      yangmaoCatalog = await fetchYangmaoData();
    } catch (ymErr) {
      console.warn(`[catalog-sync] yangmao supplement unavailable: ${ymErr instanceof Error ? ymErr.message : ymErr}`);
    }

    // 3. Build the merged catalog
    let catalog: Catalog;
    if (v1Catalog && yangmaoCatalog) {
      catalog = mergeCatalogs(v1Catalog, yangmaoCatalog);
    } else if (v1Catalog) {
      catalog = v1Catalog;
    } else if (yangmaoCatalog) {
      catalog = yangmaoCatalog;
    } else {
      throw new Error('both v1 catalog and yangmao supplement failed — nothing to apply');
    }

    // 4. Always apply — applyCatalog is idempotent
    const counts = applyCatalog(db, catalog);
    setSetting(SETTING_APPLIED_VERSION, catalog.version);
    setSetting(SETTING_APPLIED_JSON, JSON.stringify(catalog));
    if (v1Catalog) setSetting(SETTING_V1_VERSION, v1Catalog.version);
    if (yangmaoCatalog) setSetting(SETTING_YANGMA_VERSION, yangmaoCatalog.version);

    const sourceLabel = v1Catalog
      ? `v${v1Catalog.version}`
      : `yangmao-only v${yangmaoCatalog!.version}`;
    console.log(
      `[catalog-sync] applied ${sourceLabel}: ` +
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
    baseUrl: YANGMAO_URL,
    appliedVersion: getSetting(SETTING_APPLIED_VERSION) ?? null,
    lastSyncMs: Number(getSetting(SETTING_LAST_SYNC_MS)) || null,
    lastError: getSetting(SETTING_LAST_ERROR) || null,
  };
}

const CATALOG_SCHEMA_VERSION = 2; // bump when cache format changes

/**
 * Re-apply the cached (already applied) merged catalog after boot.
 *
 * On every boot the migrations re-assert the bundled baseline (INSERT OR
 * IGNORE), which would re-add the yangmao-deleted models and drift the DB
 * away from the last sync. Re-applying from the local cache is synchronous,
 * needs no network, and keeps the catalog authoritative even offline.
 *
 * Caches from before the schemaVersion field (v1) are silently discarded —
 * they lack ranking enrichment data and would overwrite freshly-synced
 * rankings with all-zero scores.
 */
export function reapplyCachedCatalog(): { reapplied: boolean; version?: string } {
  try {
    const raw = getSetting(SETTING_APPLIED_JSON);
    if (!raw) return { reapplied: false };
    const parsed: unknown = JSON.parse(raw);
    if (!isCatalog(parsed)) return { reapplied: false };
    // Get current yangma version to detect cache staleness.
    const yangmaVersion = getSetting(SETTING_YANGMA_VERSION);
    // Old caches (before this field existed) have no stored yangma version;
    // they are still valid for re-application (metadata merge only).
    if (yangmaVersion && yangmaVersion !== (parsed as Catalog).version) {
      console.log(`[catalog-sync] cache stale (v${(parsed as Catalog).version} != v${yangmaVersion}), discarding and re-syncing`);
      getDb().prepare('DELETE FROM settings WHERE key = ? OR key = ?').run('catalog_applied_version', 'catalog_applied_json');
      return { reapplied: false };
    }

    // Backfill schemaVersion for caches that predate this field.
    const record = parsed as unknown as Record<string, unknown>;
    if (!record.schemaVersion) {
      record.schemaVersion = 1;
      setSetting(SETTING_APPLIED_JSON, JSON.stringify(record));
    }
    applyCatalog(getDb(), parsed as Catalog);
    console.log(`[catalog-sync] re-applied cached yangmao v${(parsed as Catalog).version} after boot`);
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
  console.log(`[catalog-sync] polling ${catalogBaseUrl()} every ${SYNC_INTERVAL_MS / 3600000}h`);
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
