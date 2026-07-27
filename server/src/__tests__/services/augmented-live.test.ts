import Database from 'better-sqlite3';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runMigrationsSync } from '../../db/migrate/runner.js';
import { applyCatalog } from '../../services/catalog-sync.js';
import {
  hasProvider,
  registerFromCatalog,
  YANGMAO_PLATFORM_ALIASES,
  type CatalogPlatform,
} from '../../providers/index.js';
import type { Platform } from '@freellmapi/shared/types.js';

// Merge-regression check against the REAL augmented catalog (fetched to a
// local file, no network here): proves the fork's augmented-sync path works
// end to end — provider auto-registration (including yangmao alias targets),
// yangmao alias remap, source provenance, prune guard. Mirrors the real
// syncCatalog() order: registerFromCatalog first, then applyCatalog.
//
// Run with: AUG_PATH=/path/to/augmented_catalog.json

const AUG_PATH = process.env.AUG_PATH;

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

      // yangmao-* wrapper platforms themselves must never be registered...
      for (const p of catalog.platforms as CatalogPlatform[]) {
        if (p.id.startsWith('yangmao-')) {
          expect(hasProvider(p.id as Platform), `wrapper ${p.id} registered`).toBe(false);
        }
      }
      // ...but their aliased targets must be, straight from the catalog data.
      for (const target of Object.values(YANGMAO_PLATFORM_ALIASES)) {
        expect(hasProvider(target as Platform), `alias target ${target} not registered`).toBe(true);
      }

      // Aliased yangmao models must be stored under the REAL provider name
      // with source='catalog', never under the wrapper name.
      const aliased = catalog.models.filter((m: { platform: string }) => YANGMAO_PLATFORM_ALIASES[m.platform]);
      expect(aliased.length).toBeGreaterThan(0);
      let landed = 0;
      for (const m of aliased) {
        const real = YANGMAO_PLATFORM_ALIASES[m.platform]!;
        const wrapper = db
          .prepare('SELECT id FROM models WHERE platform = ? AND model_id = ?')
          .get(m.platform, m.modelId);
        expect(wrapper, `${m.platform}:${m.modelId} stored under wrapper name`).toBeUndefined();
        const row = db
          .prepare('SELECT source FROM models WHERE platform = ? AND model_id = ?')
          .get(real, m.modelId) as { source: string } | undefined;
        expect(row, `${m.platform} -> ${real}:${m.modelId}`).toBeDefined();
        expect(row!.source).toBe('catalog');
        landed++;
      }
      expect(landed).toBe(aliased.length);

      // Re-applying must be idempotent: no inserts, no removals.
      const second = applyCatalog(db as never, catalog);
      expect(second.inserted).toBe(0);
      expect(second.removed).toBe(0);
    } finally {
      db.close();
    }
  });
});
