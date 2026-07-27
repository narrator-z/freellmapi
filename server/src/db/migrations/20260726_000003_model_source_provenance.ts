// Migration: models.source provenance (catalog vs user) for the sync delete guard
// Created: 2026-07-26
//
// DOWN: reversible
//
// catalog-sync prunes chat models that the published catalog no longer lists.
// Before this column the prune had to GUESS which rows it owned from
// platform/key_id/size_label heuristics, so a hand-added model on a native
// platform (declarative config's `models:` entries, admin edits) could be
// silently deleted or clobbered on the next sync as soon as its size_label
// stopped matching the 'User'/'Custom' convention. `source` records who
// created the row at insert time:
//   'catalog' — catalog sync or the bundled baseline migrations
//   'user'    — dashboard, custom endpoints, declarative config
//
// The column DEFAULT is 'catalog' on purpose: the baseline migration's
// INSERT OR IGNORE re-seeds (run on every fresh migrations table) must stay
// catalog-owned so reapplyCachedCatalog can prune them again after boot.
// Every user-facing write path sets 'user' explicitly.

import type { Db } from '../types.js';

function hasColumn(db: Db, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((candidate) => candidate.name === column);
}

// Fork note (freellmapi-augmented): catalog-sync stores yangmao-* wrapper
// platforms under their real provider names (YANGMAO_PLATFORM_ALIASES), but
// the cached catalog_applied_json keeps the raw yangmao-* names. The backfill
// below must apply the same remap or every remapped row is misclassified as
// 'user' — frozen out of future catalog updates by the collision rule and
// immune to pruning. Keep in sync with YANGMAO_PLATFORM_ALIASES in
// providers/index.ts; duplicated here because migrations cannot import the
// provider layer (circular via db/index).
const YANGMAO_PLATFORM_ALIASES: Record<string, string> = {
  'yangmao-anyscale': 'anyscale',
  'yangmao-baichuan': 'baichuan',
  'yangmao-huggingface': 'huggingface',
  'yangmao-moonshot': 'kimi',
  'yangmao-siliconcloud': 'siliconflow',
  'yangmao-baidu': 'ernie',
  'yangmao-alibaba': 'qwen',
};

// catalog-sync resolves each catalog entry to the id the provider can call
// (routableModelId): since 2026-07-27 the pipeline emits `apiModelId` for
// display-name entries and the client prefers it; for older cached catalogs
// the google/google-ai-studio display names fall back to a slugger. The
// backfill below must mirror that exact resolution or rows stored under the
// routable id are misclassified as 'user' — frozen out of future catalog
// updates by the collision rule and immune to pruning. Duplicated here
// because migrations cannot import the service/provider layers (circular
// via db/index).
const GOOGLE_STUDIO_ID_OVERRIDES: Record<string, string> = {
  'Gemini 2.5 Flash TTS': 'gemini-2.5-flash-preview-tts',
};

function googleStudioApiModelId(displayName: string): string {
  const override = GOOGLE_STUDIO_ID_OVERRIDES[displayName];
  if (override) return override;
  return displayName
    .trim()
    .toLowerCase()
    .replace(/\binstruct\b/g, 'it')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9.-]/g, '')
    .replace(/-{2,}/g, '-');
}

// Mirrors routableModelId in services/catalog-sync.ts: apiModelId first,
// then the google display-name slug fallback, then the raw modelId.
function routableModelId(platform: string, m: { modelId: string; apiModelId?: unknown }): string {
  if (typeof m.apiModelId === 'string' && m.apiModelId.length > 0) return m.apiModelId;
  if (platform === 'google-ai-studio' || platform === 'google') return googleStudioApiModelId(m.modelId);
  return m.modelId;
}

export function up(db: Db): void {
  if (!hasColumn(db, 'models', 'source')) {
    db.prepare("ALTER TABLE models ADD COLUMN source TEXT NOT NULL DEFAULT 'catalog'").run();
  }

  // Backfill pre-existing rows, strongest signal first: everything the old
  // prune guard already treated as user-owned is user-owned.
  db.prepare(`
    UPDATE models
       SET source = 'user'
     WHERE platform = 'custom'
        OR key_id IS NOT NULL
        OR size_label IN ('User', 'Custom')
  `).run();

  // Then consult the currently-applied catalog (the signed document cached by
  // catalog-sync in settings.catalog_applied_json). A surviving row that the
  // applied catalog does not list — and that the heuristics above did not
  // claim — can only have been added locally: sync prunes catalog-owned
  // leftovers on every apply, so catalog rows absent from the catalog do not
  // linger. With no applied catalog (fresh install, never synced) every
  // remaining row came from the bundled baseline, so the 'catalog' default
  // stands.
  try {
    const setting = db
      .prepare("SELECT value FROM settings WHERE key = 'catalog_applied_json'")
      .get() as { value: string } | undefined;
    if (!setting) return;
    const parsed = JSON.parse(setting.value) as { models?: unknown };
    if (!parsed || !Array.isArray(parsed.models)) return;
    const inCatalog = new Set<string>();
    for (const m of parsed.models as { platform?: unknown; modelId?: unknown; apiModelId?: unknown }[]) {
      if (typeof m?.platform === 'string' && typeof m?.modelId === 'string') {
        // Apply the same remaps catalog-sync uses when writing rows, so DB
        // rows stored under the aliased platform / routable model id match.
        const platform = YANGMAO_PLATFORM_ALIASES[m.platform] ?? m.platform;
        inCatalog.add(`${platform}:${routableModelId(platform, m as { modelId: string; apiModelId?: unknown })}`);
      }
    }
    const rows = db
      .prepare("SELECT id, platform, model_id FROM models WHERE source = 'catalog'")
      .all() as { id: number; platform: string; model_id: string }[];
    const markUser = db.prepare("UPDATE models SET source = 'user' WHERE id = ?");
    for (const row of rows) {
      if (!inCatalog.has(`${row.platform}:${row.model_id}`)) markUser.run(row.id);
    }
  } catch {
    // A corrupt cached catalog must not block the migration; rows keep the
    // heuristic-based backfill above, which errs on the side the old guard
    // already enforced.
  }
}

export function down(db: Db): void {
  if (hasColumn(db, 'models', 'source')) {
    db.prepare('ALTER TABLE models DROP COLUMN source').run();
  }
}
