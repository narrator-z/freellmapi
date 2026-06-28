import { describe, it, expect, beforeAll } from 'vitest';
import { initDb, getDb, setSetting, getSetting } from '../../db/index.js';
import {
  applyCatalog,
  reapplyCachedCatalog,
  toSlug,
  mergeRankings,
} from '../../services/catalog-sync.js';
import { runMigrationsSync } from '../../db/migrate/runner.js';
import { recordCatalogModelTombstone, upsertModelOverrides } from '../../services/model-state.js';

// ---- toSlug normalization tests ----

describe('toSlug', () => {
  it('converts Title Case with spaces to kebab-case', () => {
    expect(toSlug('Llama 3.3 70B Versatile')).toBe('llama-3.3-70b-versatile');
  });

  it('preserves dots for version numbers', () => {
    expect(toSlug('Qwen2.5-Coder-32B-Instruct')).toBe('qwen2.5-coder-32b-instruct');
  });

  it('handles model IDs with @ prefix and slashes', () => {
    expect(toSlug('@cf/meta/llama-3.1-8b-instruct')).toBe('cf-meta-llama-3.1-8b-instruct');
  });

  it('handles colons in version suffixes', () => {
    expect(toSlug('qwen3-coder:480b')).toBe('qwen3-coder-480b');
  });

  it('handles underscores', () => {
    expect(toSlug('Meta_Llama_3.1')).toBe('meta-llama-3.1');
  });

  it('collapses repeated hyphens', () => {
    expect(toSlug('A  B')).toBe('a-b');
  });

  it('trims leading/trailing hyphens', () => {
    expect(toSlug('---Hello---')).toBe('hello');
  });
});

// ---- mergeRankings matching tests ----

describe('mergeRankings', () => {
  it('matches by exact platform/modelId key', () => {
    const models = [{
      platform: 'groq', modelId: 'llama-3.3-70b-versatile',
      displayName: 'Llama 3.3 70B Versatile', intelligenceRank: 0, speedRank: 0,
      sizeLabel: '', limits: { rpm: null, rpd: null, tpm: null, tpd: null },
      monthlyTokenBudget: '', contextWindow: null, enabled: true,
      supportsVision: false, supportsTools: false,
    }];
    const rankings = new Map();
    rankings.set('groq/llama-3.3-70b-versatile', {
      intelligenceRank: 17, speedRank: 10, sizeLabel: 'Medium',
      limits: { rpm: 30, rpd: 1000, tpm: 6000, tpd: null },
      monthlyTokenBudget: '~1M', contextWindow: 131072,
      supportsVision: false, supportsTools: true,
    });
    const result = mergeRankings(models, rankings);
    expect(result[0].intelligenceRank).toBe(17);
    expect(result[0].speedRank).toBe(10);
  });

  it('yangmao slugified modelId matches ranking catalog by exact key', () => {
    // After the toSlug normalization in fetchYangmaoData, yangmao modelIds
    // are already in kebab-case, so mergeRankings finds the match directly.
    const models = [{
      platform: 'groq', modelId: 'llama-3.3-70b-versatile',
      displayName: 'Llama 3.3 70B Versatile', intelligenceRank: 0, speedRank: 0,
      sizeLabel: '', limits: { rpm: null, rpd: null, tpm: null, tpd: null },
      monthlyTokenBudget: '', contextWindow: null, enabled: true,
      supportsVision: false, supportsTools: false,
    }];
    const rankings = new Map();
    rankings.set('groq/llama-3.3-70b-versatile', {
      intelligenceRank: 17, speedRank: 10, sizeLabel: 'Medium',
      limits: { rpm: 30, rpd: 1000, tpm: 6000, tpd: null },
      monthlyTokenBudget: '~1M', contextWindow: 131072,
      supportsVision: false, supportsTools: true,
    });
    const result = mergeRankings(models, rankings);
    expect(result[0].intelligenceRank).toBe(17);
    expect(result[0].speedRank).toBe(10);
  });

  it('matches via platform alias (nvidia-build → nvidia)', () => {
    const models = [{
      platform: 'nvidia-build', modelId: 'DeepSeek-V4-Pro',
      displayName: 'DeepSeek-V4-Pro', intelligenceRank: 0, speedRank: 0,
      sizeLabel: '', limits: { rpm: null, rpd: null, tpm: null, tpd: null },
      monthlyTokenBudget: '', contextWindow: null, enabled: true,
      supportsVision: false, supportsTools: false,
    }];
    const rankings = new Map();
    rankings.set('nvidia/deepseek-ai/deepseek-v4-pro', {
      intelligenceRank: 3, speedRank: 9, sizeLabel: 'Large',
      limits: { rpm: 100, rpd: null, tpm: null, tpd: null },
      monthlyTokenBudget: '', contextWindow: 65536,
      supportsVision: false, supportsTools: true,
    });
    const result = mergeRankings(models, rankings);
    expect(result[0].intelligenceRank).toBe(3);
    expect(result[0].speedRank).toBe(9);
  });

  it('leaves unmatched models unchanged', () => {
    const models = [{
      platform: 'some-platform', modelId: 'Some Model',
      displayName: 'Some Model', intelligenceRank: 0, speedRank: 0,
      sizeLabel: '', limits: { rpm: null, rpd: null, tpm: null, tpd: null },
      monthlyTokenBudget: '', contextWindow: null, enabled: true,
      supportsVision: false, supportsTools: false,
    }];
    const rankings = new Map();
    rankings.set('groq/llama-3.3-70b-versatile', {
      intelligenceRank: 17, speedRank: 10, sizeLabel: 'Medium',
      limits: { rpm: 30, rpd: 1000, tpm: 6000, tpd: null },
      monthlyTokenBudget: '~1M', contextWindow: 131072,
      supportsVision: false, supportsTools: true,
    });
    const result = mergeRankings(models, rankings);
    expect(result[0].intelligenceRank).toBe(0); // unchanged
  });

  it('matches by slug fallback when exact and alias keys miss', () => {
    // Yangmao modelId is already slugified, but the ranking catalog may use
    // a different platform ID (e.g. yangmao "nvidia-build" → ranking "nvidia")
    // with a nested path like "nvidia/minimaxai/minimax-m2.7". The slug
    // fallback extracts the last path segment to find the match.
    const models = [{
      platform: 'nvidia-build', modelId: 'minimax-m2.7',
      displayName: 'MiniMax-M2.7', intelligenceRank: 0, speedRank: 0,
      sizeLabel: '', limits: { rpm: null, rpd: null, tpm: null, tpd: null },
      monthlyTokenBudget: '', contextWindow: null, enabled: true,
      supportsVision: false, supportsTools: false,
    }];
    const rankings = new Map();
    rankings.set('nvidia/minimaxai/minimax-m2.7', {
      intelligenceRank: 3, speedRank: 9, sizeLabel: 'Large',
      limits: { rpm: 100, rpd: null, tpm: null, tpd: null },
      monthlyTokenBudget: '', contextWindow: 65536,
      supportsVision: false, supportsTools: true,
    });
    const result = mergeRankings(models, rankings);
    expect(result[0].intelligenceRank).toBe(3);
  });
});

// applyCatalog is the write path between the published catalog and the live
// router DB. These tests lock its contract: catalog metadata always wins, the
// user's manual disables survive, custom-provider models are untouchable, and
// disappeared models are removed in FK-safe order.

type AnyCatalog = Parameters<typeof applyCatalog>[1];

function baseModel(over: Partial<AnyCatalog['models'][number]> = {}): AnyCatalog['models'][number] {
  return {
    platform: 'groq',
    modelId: 'test-model',
    displayName: 'Test Model',
    intelligenceRank: 10,
    speedRank: 5,
    sizeLabel: 'Medium',
    limits: { rpm: 30, rpd: 1000, tpm: 6000, tpd: null },
    monthlyTokenBudget: '~1M',
    contextWindow: 8192,
    enabled: true,
    supportsVision: false,
    supportsTools: true,
    ...over,
  };
}

function catalogOf(models: AnyCatalog['models'], quirks: AnyCatalog['quirks'] = []): AnyCatalog {
  return {
    version: '2099.01.01',
    generatedAt: new Date().toISOString(),
    tier: 'live',
    models,
    quirks,
  };
}

/** Snapshot every catalog-managed model as catalog entries so applyCatalog keeps them. */
function existingAsCatalogModels(): AnyCatalog['models'] {
  const rows = getDb()
    .prepare(
      `SELECT platform, model_id, display_name, intelligence_rank, speed_rank, size_label,
              rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window,
              enabled, supports_vision, supports_tools
         FROM models WHERE platform != 'custom' AND key_id IS NULL`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) =>
    baseModel({
      platform: r.platform as string,
      modelId: r.model_id as string,
      displayName: r.display_name as string,
      intelligenceRank: r.intelligence_rank as number,
      speedRank: r.speed_rank as number,
      sizeLabel: r.size_label as string,
      limits: {
        rpm: r.rpm_limit as number | null,
        rpd: r.rpd_limit as number | null,
        tpm: r.tpm_limit as number | null,
        tpd: r.tpd_limit as number | null,
      },
      monthlyTokenBudget: r.monthly_token_budget as string,
      contextWindow: r.context_window as number | null,
      enabled: (r.enabled as number) === 1,
      supportsVision: (r.supports_vision as number) === 1,
      supportsTools: (r.supports_tools as number) === 1,
    }),
  );
}

describe('applyCatalog', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  it('inserts a new model with a fallback_config row', () => {
    const models = existingAsCatalogModels();
    models.push(baseModel({ modelId: 'brand-new-model', displayName: 'Brand New' }));

    const counts = applyCatalog(getDb(), catalogOf(models));
    expect(counts.inserted).toBe(1);

    const row = getDb()
      .prepare("SELECT id, enabled FROM models WHERE platform = 'groq' AND model_id = 'brand-new-model'")
      .get() as { id: number; enabled: number };
    expect(row.enabled).toBe(1);
    const fb = getDb().prepare('SELECT id FROM fallback_config WHERE model_db_id = ?').get(row.id);
    expect(fb).toBeTruthy();
  });

  it('updates metadata in place and respects the enabled policy', () => {
    const models = existingAsCatalogModels();
    const target = models.find((m) => m.modelId === 'brand-new-model')!;

    // User disables the model locally; catalog still says enabled -> stays off.
    getDb()
      .prepare("UPDATE models SET enabled = 0 WHERE platform = 'groq' AND model_id = 'brand-new-model'")
      .run();
    target.displayName = 'Brand New v2';
    target.limits = { rpm: 99, rpd: null, tpm: null, tpd: null };
    applyCatalog(getDb(), catalogOf(models));

    let row = getDb()
      .prepare("SELECT display_name, rpm_limit, enabled FROM models WHERE platform = 'groq' AND model_id = 'brand-new-model'")
      .get() as { display_name: string; rpm_limit: number; enabled: number };
    expect(row.display_name).toBe('Brand New v2');
    expect(row.rpm_limit).toBe(99);
    expect(row.enabled).toBe(0); // local disable survives

    // Catalog disables (dead upstream) -> force off even if user re-enabled.
    getDb()
      .prepare("UPDATE models SET enabled = 1 WHERE platform = 'groq' AND model_id = 'brand-new-model'")
      .run();
    target.enabled = false;
    applyCatalog(getDb(), catalogOf(models));
    row = getDb()
      .prepare("SELECT display_name, rpm_limit, enabled FROM models WHERE platform = 'groq' AND model_id = 'brand-new-model'")
      .get() as typeof row;
    expect(row.enabled).toBe(0);
  });

  it('removes models that left the catalog (and their fallback rows)', () => {
    const models = existingAsCatalogModels().filter((m) => m.modelId !== 'brand-new-model');
    const before = getDb()
      .prepare("SELECT id FROM models WHERE model_id = 'brand-new-model'")
      .get() as { id: number };

    const counts = applyCatalog(getDb(), catalogOf(models));
    expect(counts.removed).toBe(1);
    expect(getDb().prepare("SELECT id FROM models WHERE model_id = 'brand-new-model'").get()).toBeUndefined();
    expect(getDb().prepare('SELECT id FROM fallback_config WHERE model_db_id = ?').get(before.id)).toBeUndefined();
  });

  it('never touches custom-provider models', () => {
    getDb()
      .prepare(
        `INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, size_label, enabled)
         VALUES ('custom', 'my-local-model', 'My Local', 50, 50, 'Custom', 1)`,
      )
      .run();

    // Catalog without the custom model: it must survive the delete pass.
    applyCatalog(getDb(), catalogOf(existingAsCatalogModels().filter((m) => m.platform !== 'custom')));
    const row = getDb().prepare("SELECT enabled FROM models WHERE platform = 'custom'").get() as { enabled: number };
    expect(row.enabled).toBe(1);
  });

  it('re-applies local model overrides after catalog metadata refreshes', () => {
    const models = existingAsCatalogModels().filter((m) => m.modelId !== 'override-model');
    models.push(baseModel({
      modelId: 'override-model',
      displayName: 'Catalog Name',
      contextWindow: 1000,
      supportsTools: false,
    }));
    applyCatalog(getDb(), catalogOf(models));

    upsertModelOverrides(getDb(), 'groq', 'override-model', {
      displayName: 'Local Name',
      contextWindow: 12345,
      supportsTools: true,
    });

    const refreshed = existingAsCatalogModels().filter((m) => m.modelId !== 'override-model');
    refreshed.push(baseModel({
      modelId: 'override-model',
      displayName: 'Catalog Name v2',
      contextWindow: 2000,
      supportsTools: false,
    }));
    applyCatalog(getDb(), catalogOf(refreshed));

    const row = getDb().prepare(`
      SELECT display_name, context_window, supports_tools
        FROM models
       WHERE platform = 'groq' AND model_id = 'override-model'
    `).get() as { display_name: string; context_window: number; supports_tools: number };
    expect(row).toEqual({ display_name: 'Local Name', context_window: 12345, supports_tools: 1 });
  });

  it('keeps user-deleted catalog models deleted across catalog refreshes', () => {
    const models = existingAsCatalogModels().filter((m) => m.modelId !== 'tombstone-model');
    models.push(baseModel({ modelId: 'tombstone-model', displayName: 'Tombstone Me' }));
    applyCatalog(getDb(), catalogOf(models));
    expect(getDb().prepare("SELECT id FROM models WHERE platform = 'groq' AND model_id = 'tombstone-model'").get()).toBeDefined();

    recordCatalogModelTombstone(getDb(), 'chat', 'groq', 'tombstone-model');
    applyCatalog(getDb(), catalogOf(models));
    expect(getDb().prepare("SELECT id FROM models WHERE platform = 'groq' AND model_id = 'tombstone-model'").get()).toBeUndefined();

    applyCatalog(getDb(), catalogOf(models));
    expect(getDb().prepare("SELECT id FROM models WHERE platform = 'groq' AND model_id = 'tombstone-model'").get()).toBeUndefined();
  });

  it('skips models for platforms this binary has no provider for', () => {
    const models = existingAsCatalogModels();
    models.push(baseModel({ platform: 'some-future-provider', modelId: 'future-model' }));
    const counts = applyCatalog(getDb(), catalogOf(models));
    expect(counts.skippedUnknownPlatform).toBeGreaterThanOrEqual(1);
    expect(getDb().prepare("SELECT id FROM models WHERE platform = 'some-future-provider'").get()).toBeUndefined();
  });

  it('replaces quirks wholesale', () => {
    const quirks: AnyCatalog['quirks'] = [
      {
        slug: 'fresh-quirk',
        title: 'Fresh quirk',
        body: 'New knowledge from the catalog.',
        severity: 'warning',
        targets: [{ platform: 'groq', modelGlob: null }],
      },
    ];
    const counts = applyCatalog(getDb(), catalogOf(existingAsCatalogModels(), quirks));
    expect(counts.quirks).toBe(1);

    const all = getDb().prepare('SELECT slug FROM quirks').all() as { slug: string }[];
    expect(all.map((q) => q.slug)).toEqual(['fresh-quirk']);
    const targets = getDb().prepare('SELECT platform, model_glob FROM quirk_targets').all();
    expect(targets).toEqual([{ platform: 'groq', model_glob: null }]);
  });
});

// reapplyCachedCatalog keeps the catalog authoritative across restarts:
// migrations re-assert the bundled baseline on every boot (INSERT OR IGNORE
// re-adds catalog-deleted models, family rules reset flags) while the boot
// sync 304s on an unchanged version. The cached re-apply closes that gap.
describe('reapplyCachedCatalog', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  function cacheCatalog(catalog: AnyCatalog) {
    setSetting('catalog_applied_version', catalog.version);
    setSetting('catalog_applied_tier', catalog.tier);
    setSetting('catalog_applied_json', JSON.stringify(catalog));
    setSetting('catalog_yangma_version', catalog.version);
  }

  it('restores catalog state over a re-run of the baseline migrations', () => {
    // Catalog says: one baseline model is gone. The victim must be one that a
    // re-runnable migration re-inserts on boot (V23's INSERT OR IGNORE rows),
    // not a first-init-only seed row — that re-insertion is the exact drift
    // this function exists to undo.
    const models = existingAsCatalogModels();
    const victim = models.find((m) => m.platform === 'openrouter' && m.modelId === 'moonshotai/kimi-k2.6:free')!;
    expect(victim).toBeDefined();
    const remaining = models.filter((m) => m.modelId !== victim.modelId);
    const catalog = catalogOf(remaining);
    applyCatalog(getDb(), catalog);
    cacheCatalog(catalog);
    expect(
      getDb().prepare('SELECT id FROM models WHERE platform = ? AND model_id = ?').get(victim.platform, victim.modelId),
    ).toBeUndefined();

    // Simulate a restart: migrations re-insert the baseline model.
    getDb().exec('DROP TABLE migrations');
    runMigrationsSync(getDb(), 'up');
    expect(
      getDb().prepare('SELECT id FROM models WHERE platform = ? AND model_id = ?').get(victim.platform, victim.modelId),
    ).toBeDefined();

    // Boot re-apply removes it again from the local cache, no network.
    const result = reapplyCachedCatalog();
    expect(result.reapplied).toBe(true);
    expect(result.version).toBe(catalog.version);
    expect(
      getDb().prepare('SELECT id FROM models WHERE platform = ? AND model_id = ?').get(victim.platform, victim.modelId),
    ).toBeUndefined();
  });

  it('is a no-op without throwing on a corrupt cache', () => {
    setSetting('catalog_applied_json', 'not json at all {');
    expect(reapplyCachedCatalog().reapplied).toBe(false);
  });

  it('discards stale cache when yangmao version has changed', () => {
    const models = existingAsCatalogModels();
    const oldCatalog = catalogOf(models);
    cacheCatalog(oldCatalog);
    // Simulate a newer yangmao version stored in settings
    setSetting('catalog_yangma_version', '2099.06.01');
    const result = reapplyCachedCatalog();
    expect(result.reapplied).toBe(false);
    // Cache should be cleared
    expect(getSetting('catalog_applied_version')).toBeUndefined();
    expect(getSetting('catalog_applied_json')).toBeUndefined();
  });

  it('re-applies when cached version matches yangmao version', () => {
    const models = existingAsCatalogModels();
    // Pick any existing model as the removal target
    const victim = models[0];
    const catalog = catalogOf(models.filter((m) => m !== victim));
    applyCatalog(getDb(), catalog);
    cacheCatalog(catalog);
    setSetting('catalog_yangma_version', catalog.version);
    runMigrationsSync(getDb(), 'up'); // re-insert baseline model
    const result = reapplyCachedCatalog();
    expect(result.reapplied).toBe(true);
    expect(result.version).toBe(catalog.version);
  });
});
