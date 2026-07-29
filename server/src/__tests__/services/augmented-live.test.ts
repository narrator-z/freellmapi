import Database from 'better-sqlite3';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runMigrationsSync } from '../../db/migrate/runner.js';
import { applyAugmentedCatalog } from '../../services/augmented-catalog-sync.js';
import { googleStudioApiModelId } from '../../providers/google.js';
import {
  hasProvider,
  registerFromCatalog,
  YANGMAO_PLATFORM_ALIASES,
  type CatalogPlatform,
} from '../../providers/index.js';
import type { Platform } from '@freellmapi/shared/types.js';

describe('googleStudioApiModelId', () => {
  it('slugifies v1-lineage display names to native Gemini API ids', () => {
    expect(googleStudioApiModelId('Gemini 2.5 Flash')).toBe('gemini-2.5-flash');
    expect(googleStudioApiModelId('Gemini 2.5 Flash-Lite')).toBe('gemini-2.5-flash-lite');
    expect(googleStudioApiModelId('Gemma 3 27B Instruct')).toBe('gemma-3-27b-it');
    expect(googleStudioApiModelId('Gemma 4 26B A4B Instruct')).toBe('gemma-4-26b-a4b-it');
    expect(googleStudioApiModelId('Gemini Robotics-ER 1.5')).toBe('gemini-robotics-er-1.5');
  });

  it('uses explicit overrides where the API id is not a mechanical slug', () => {
    expect(googleStudioApiModelId('Gemini 2.5 Flash TTS')).toBe('gemini-2.5-flash-preview-tts');
  });
});

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

      // Same order as the augmented sync: auto-register, then apply.
      registerFromCatalog(catalog.platforms as CatalogPlatform[]);
      const counts = applyAugmentedCatalog(db as never, catalog);
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
      // with source='catalog', never under the wrapper name. The routable id
      // is apiModelId when the pipeline emits one, else the raw modelId.
      const aliased = catalog.models.filter((m: { platform: string }) => YANGMAO_PLATFORM_ALIASES[m.platform]);
      expect(aliased.length).toBeGreaterThan(0);
      let landed = 0;
      for (const m of aliased) {
        const real = YANGMAO_PLATFORM_ALIASES[m.platform]!;
        const apiId = m.apiModelId ?? m.modelId;
        const wrapper = db
          .prepare('SELECT id FROM models WHERE platform = ? AND model_id = ?')
          .get(m.platform, m.modelId);
        expect(wrapper, `${m.platform}:${m.modelId} stored under wrapper name`).toBeUndefined();
        const row = db
          .prepare('SELECT source FROM models WHERE platform = ? AND model_id = ?')
          .get(real, apiId) as { source: string } | undefined;
        expect(row, `${m.platform} -> ${real}:${apiId}`).toBeDefined();
        expect(row!.source).toBe('catalog');
        landed++;
      }
      expect(landed).toBe(aliased.length);

      // The v1-lineage fork platforms are statically registered (see
      // providers/index.ts) so their models route under their own platform ids.
      expect(hasProvider('google-ai-studio' as Platform)).toBe(true);
      expect(hasProvider('mistral-la-plateforme' as Platform)).toBe(true);
      const junk = db
        .prepare('SELECT id FROM models WHERE model_id = ?')
        .get('Open and Proprietary Mistral models');
      expect(junk).toBeUndefined();

      // Every display-name entry (space in modelId) must land under its
      // apiModelId — never as an unroutable verbatim row, on any platform.
      const displayEntries = catalog.models.filter((m: { modelId: string }) => m.modelId.includes(' '));
      expect(displayEntries.length).toBeGreaterThan(0);
      for (const m of displayEntries) {
        const platform = YANGMAO_PLATFORM_ALIASES[m.platform] ?? m.platform;
        if (!m.apiModelId) continue; // contract: pipeline guarantees coverage
        const row = db
          .prepare('SELECT source FROM models WHERE platform = ? AND model_id = ?')
          .get(platform, m.apiModelId) as { source: string } | undefined;
        if (hasProvider(platform as Platform)) {
          expect(row, `${platform}:${m.apiModelId} (from "${m.modelId}")`).toBeDefined();
          expect(row!.source).toBe('catalog');
        }
        const raw = db
          .prepare('SELECT id FROM models WHERE platform = ? AND model_id = ?')
          .get(platform, m.modelId);
        expect(raw, `display-name id "${m.modelId}" stored verbatim`).toBeUndefined();
      }

      // Global invariant: after apply, no chat row carries a display-name id.
      const spaced = db
        .prepare("SELECT platform, model_id FROM models WHERE model_id LIKE '% %'")
        .all() as { platform: string; model_id: string }[];
      expect(spaced, `display-name rows survived: ${JSON.stringify(spaced)}`).toHaveLength(0);

      // Re-applying must be idempotent: no inserts, no removals.
      const second = applyAugmentedCatalog(db as never, catalog);
      expect(second.inserted).toBe(0);
      expect(second.removed).toBe(0);
    } finally {
      db.close();
    }
  });
});
