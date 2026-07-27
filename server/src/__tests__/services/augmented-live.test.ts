import Database from 'better-sqlite3';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runMigrationsSync } from '../../db/migrate/runner.js';
import { applyCatalog } from '../../services/catalog-sync.js';
import { hasProvider, registerFromCatalog, type CatalogPlatform } from '../../providers/index.js';
import type { Platform } from '@freellmapi/shared/types.js';

// Merge-regression check against the REAL augmented catalog (fetched to a
// local file by the merge verification, no network here): proves the fork's
// augmented-sync path still works end to end after merging upstream v0.6.0 —
// provider auto-registration, yangmao alias remap, source provenance, prune
// guard and all. Mirrors the real syncCatalog() order: registerFromCatalog
// first, then applyCatalog.

const AUG_PATH = process.env.AUG_PATH;
const YANGMAO_ALIASES: Record<string, string> = {
  'yangmao-anyscale': 'anyscale',
  'yangmao-baichuan': 'baichuan',
  'yangmao-huggingface': 'huggingface',
  'yangmao-moonshot': 'kimi',
  'yangmao-siliconcloud': 'siliconflow',
  'yangmao-baidu': 'ernie',
  'yangmao-alibaba': 'qwen',
};

describe.skipIf(!AUG_PATH || !fs.existsSync(AUG_PATH))('live augmented catalog apply', () => {
  it('applies the augmented catalog exactly like syncCatalog does', () => {
    const catalog = JSON.parse(fs.readFileSync(AUG_PATH!, 'utf8'));
    const db = new Database(':memory:');
    try {
      runMigrationsSync(db as never, 'up');

      // Same order as syncCatalog(): auto-register, then apply.
      registerFromCatalog(catalog.platforms as CatalogPlatform[]);
      const counts = applyCatalog(db as never, catalog);
      console.log('apply counts:', counts);
      expect(counts.inserted + counts.updated).toBeGreaterThan(0);

      // yangmao-* wrapper platforms must never be auto-registered.
      for (const p of catalog.platforms as CatalogPlatform[]) {
        if (p.id.startsWith('yangmao-')) {
          expect(hasProvider(p.id as Platform), `wrapper ${p.id} registered`).toBe(false);
        }
      }

      // Aliased yangmao models: when the real target provider exists, the row
      // must be stored under the REAL name with source='catalog', never under
      // the wrapper name; when the target is not registered (pre-existing
      // fork gap: qwen/kimi/anyscale/baichuan/ernie), the model is skipped.
      // Note: with today's catalog every yangmao alias target is unregistered,
      // so the whole alias pathway is dormant — the assertions inside the
      // loop pin the contract for when providers/catalog entries appear.
      const aliased = catalog.models.filter((m: { platform: string }) => YANGMAO_ALIASES[m.platform]);
      expect(aliased.length).toBeGreaterThan(0);
      for (const m of aliased) {
        const real = YANGMAO_ALIASES[m.platform]!;
        const wrapper = db
          .prepare('SELECT id FROM models WHERE platform = ? AND model_id = ?')
          .get(m.platform, m.modelId);
        expect(wrapper, `${m.platform}:${m.modelId} stored under wrapper name`).toBeUndefined();
        if (hasProvider(real as Platform)) {
          const row = db
            .prepare('SELECT source FROM models WHERE platform = ? AND model_id = ?')
            .get(real, m.modelId) as { source: string } | undefined;
          expect(row, `${m.platform} -> ${real}:${m.modelId}`).toBeDefined();
          expect(row!.source).toBe('catalog');
        }
      }

      // Re-applying must be idempotent: no inserts, no removals.
      const second = applyCatalog(db as never, catalog);
      expect(second.inserted).toBe(0);
      expect(second.removed).toBe(0);
    } finally {
      db.close();
    }
  });
});
