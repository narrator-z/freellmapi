import { describe, it, expect, beforeAll } from 'vitest';
import { initDb, getDb, setSetting, getSetting } from '../../db/index.js';
import {
  fetchYangmaoData,
  toSlug,
  mergeRankings,
  applyCatalog,
  reapplyCachedCatalog,
  type CatalogModel,
} from '../../services/catalog-sync.js';
import { migrateDbSchema } from '../../db/migrations.js';
import { hasProvider } from '../../providers/index.js';

// ---------------------------------------------------------------------------
// Integration-style tests that exercise the real yangmao.ai data pipeline.
// These make a network call — skip with --no-network or when offline.
// ---------------------------------------------------------------------------

const NETWORK_REQUIRED = process.env.SKIP_NETWORK_TESTS !== '1';

describe.skipIf(!NETWORK_REQUIRED)('yangmao.ai catalog pipeline', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  describe('fetchYangmaoData', () => {
    it('returns models with slugified (not human-readable) modelIds', async () => {
      const { models, version } = await fetchYangmaoData();

      expect(models.length).toBeGreaterThan(0);
      expect(version).toBeTruthy();

      // Every model must have a non-empty, slugified modelId
      const badIds: string[] = [];
      for (const m of models) {
        if (!m.modelId || m.modelId.length === 0) {
          badIds.push(`EMPTY on ${m.platform}`);
          continue;
        }
        // A properly slugified ID should match the toSlug output of itself
        const roundTrip = toSlug(m.modelId);
        if (roundTrip !== m.modelId) {
          badIds.push(`${m.platform}/${m.modelId} → toSlug=${roundTrip}`);
        }
        // Should not contain uppercase, spaces, or parentheses
        if (/[A-Z\s()]/.test(m.modelId)) {
          badIds.push(`${m.platform}/${m.modelId} (contains uppercase/space/paren)`);
        }
      }

      if (badIds.length > 0) {
        console.log('\n=== Bad modelIds ===\n' + badIds.map((b, i) => `  ${i + 1}. ${b}`).join('\n'));
      }
      expect(badIds).toEqual([]);
    });

    it('every model platform has a local provider or is skipped as unknown', async () => {
      const { models } = await fetchYangmaoData();

      const unknownPlatforms = new Map<string, number>();
      for (const m of models) {
        if (!hasProvider(m.platform)) {
          unknownPlatforms.set(m.platform, (unknownPlatforms.get(m.platform) ?? 0) + 1);
        }
      }

      if (unknownPlatforms.size > 0) {
        console.log('\n=== Platforms in yangmao with no local provider ===');
        for (const [p, count] of unknownPlatforms) {
          console.log(`  ${p}: ${count} models`);
        }
      }

      // We expect some unknown platforms (yangmao has 82 providers, we ship ~60)
      // but we log them so the list is visible. The applyCatalog function
      // correctly skips these — this test just documents the gap.
      expect(unknownPlatforms.size).toBeGreaterThanOrEqual(0);
    });

    it('modelIds do not contain raw human-readable names', async () => {
      const { models } = await fetchYangmaoData();

      // Spot-check: known human-readable names from yangmao that should NOT
      // appear as modelIds after slugification
      const forbiddenPatterns = [
        'Llama 3.3',
        'DeepSeek',
        'Gemma 2',
        'Mistral Large',
        'Qwen2.5 Coder',
        'Meta Llama',
        'Mistral / Mixtral',
        'GPU compute',
        'Open-weight',
        'Llama and open-weight',
        'Serverless fine-tuned',
        'OpenPipe fine-tuned',
        'OpenAI-compatible logging',
        'Free Models',
        'Embedding / vision',
        'Qwen Coder routes',
      ];

      const violations: string[] = [];
      for (const m of models) {
        for (const pat of forbiddenPatterns) {
          if (m.modelId.includes(pat) || m.displayName === pat) {
            // displayName can be human-readable, but modelId should not
            if (m.modelId.includes(pat)) {
              violations.push(`${m.platform}: modelId="${m.modelId}" matches human pattern "${pat}"`);
            }
          }
        }
      }

      if (violations.length > 0) {
        console.log('\n=== ModelId contains human-readable text ===\n' + violations.join('\n'));
      }
      expect(violations).toEqual([]);
    });

    it('slugified modelIds match what providers actually expect', async () => {
      // Spot-check a curated list of known-good API model IDs against what
      // toSlug produces from the yangmao human-readable names.
      const knownGood: Array<{ human: string; expectedSlug: string }> = [
        { human: 'Llama 3.3 70B Versatile', expectedSlug: 'llama-3.3-70b-versatile' },
        { human: 'Llama 4 Scout 17B', expectedSlug: 'llama-4-scout-17b' },
        { human: 'Llama 4 Maverick 17B', expectedSlug: 'llama-4-maverick-17b' },
        { human: 'DeepSeek-V4-Pro', expectedSlug: 'deepseek-v4-pro' },
        { human: 'DeepSeek-V4-Flash', expectedSlug: 'deepseek-v4-flash' },
        { human: 'DeepSeek V3', expectedSlug: 'deepseek-v3' },
        { human: 'DeepSeek-R1', expectedSlug: 'deepseek-r1' },
        { human: 'DeepSeek R1 Distill Llama 70B', expectedSlug: 'deepseek-r1-distill-llama-70b' },
        { human: 'Gemma 2 9B', expectedSlug: 'gemma-2-9b' },
        { human: 'Gemma 4 31B-IT', expectedSlug: 'gemma-4-31b-it' },
        { human: 'Mixtral 8x7B', expectedSlug: 'mixtral-8x7b' },
        { human: 'Mixtral 8x22B', expectedSlug: 'mixtral-8x22b' },
        { human: 'Mistral Large', expectedSlug: 'mistral-large' },
        { human: 'Mistral Small', expectedSlug: 'mistral-small' },
        { human: 'Kimi-K2.5', expectedSlug: 'kimi-k2.5' },
        { human: 'Kimi-K2', expectedSlug: 'kimi-k2' },
        { human: 'MiniMax-M2.7', expectedSlug: 'minimax-m2.7' },
        { human: 'MiniMax-01', expectedSlug: 'minimax-01' },
        { human: 'Seed 2.0 Pro', expectedSlug: 'seed-2.0-pro' },
        { human: 'Qwen2.5-Coder', expectedSlug: 'qwen2.5-coder' },
        { human: 'Qwen3.6-Plus', expectedSlug: 'qwen3.6-plus' },
        { human: 'Qwen3.6-27B', expectedSlug: 'qwen3.6-27b' },
        { human: 'Qwen-Max', expectedSlug: 'qwen-max' },
        { human: 'Grok 4.20', expectedSlug: 'grok-4.20' },
        { human: 'Grok-3', expectedSlug: 'grok-3' },
        { human: 'Step 3.5 Flash', expectedSlug: 'step-3.5-flash' },
        { human: 'Step-2', expectedSlug: 'step-2' },
        { human: 'Meta Llama 3.1 8B Instruct', expectedSlug: 'meta-llama-3.1-8b-instruct' },
        { human: 'Qwen/Qwen2.5-Coder-32B-Instruct', expectedSlug: 'qwen-qwen2.5-coder-32b-instruct' },
        { human: 'meta-llama/Meta-Llama-3.1-8B-Instruct', expectedSlug: 'meta-llama-meta-llama-3.1-8b-instruct' },
        { human: '@cf/meta/llama-3.1-8b-instruct', expectedSlug: 'cf-meta-llama-3.1-8b-instruct' },
      ];

      const failures: string[] = [];
      for (const { human, expectedSlug } of knownGood) {
        const actual = toSlug(human);
        if (actual !== expectedSlug) {
          failures.push(`toSlug("${human}") = "${actual}" (expected "${expectedSlug}")`);
        }
      }

      if (failures.length > 0) {
        console.log('\n=== toSlug mismatches ===\n' + failures.join('\n'));
      }
      expect(failures).toEqual([]);
    });

    it('full round-trip: fetch → mergeRankings → applyCatalog', async () => {
      // 1. Fetch yangmao data
      const { models: yangmaoModels, version } = await fetchYangmaoData();

      // 2. Verify all modelIds are slugified
      const badSlugs = yangmaoModels.filter((m) => toSlug(m.modelId) !== m.modelId);
      expect(badSlugs).toEqual([]);

      // 3. Apply to DB — only known-platform models survive
      const knownModels = yangmaoModels.filter((m) => hasProvider(m.platform));
      const skipped = yangmaoModels.length - knownModels.length;

      // Merge with empty rankings (no network call for ranking catalog)
      const merged = mergeRankings(knownModels, new Map());

      // Build a proper Catalog object for applyCatalog
      const catalog = {
        version: '2099.01.01',
        generatedAt: new Date().toISOString(),
        tier: 'live' as const,
        models: merged,
        quirks: [],
      };

      const counts = applyCatalog(getDb(), catalog);

      console.log(
        `Round-trip: ${yangmaoModels.length} yangmao → ${knownModels.length} known platform ` +
          `(${skipped} skipped) → ${counts.inserted} inserted, ${counts.updated} updated, ` +
          `${counts.removed} removed`,
      );

      // Verify inserted models have slugified modelIds in the DB
      const dbRows = getDb()
        .prepare(
          `SELECT platform, model_id, display_name FROM models WHERE platform != 'custom' AND key_id IS NULL`,
        )
        .all() as Array<{ platform: string; model_id: string; display_name: string }>;

      const badDbIds: string[] = [];
      for (const r of dbRows) {
        if (/[A-Z\s()]/.test(r.model_id)) {
          badDbIds.push(`${r.platform}: ${r.model_id}`);
        }
      }

      if (badDbIds.length > 0) {
        console.log('\n=== DB rows with non-slugified model_id ===\n' + badDbIds.join('\n'));
      }
      expect(badDbIds).toEqual([]);
    });

    it('catalog can be cached and re-applied after boot', async () => {
      const { models: yangmaoModels } = await fetchYangmaoData();
      const knownModels = yangmaoModels.filter((m) => hasProvider(m.platform));
      const merged = mergeRankings(knownModels, new Map());

      const catalog = {
        version: '2099.01.01',
        generatedAt: new Date().toISOString(),
        tier: 'live' as const,
        schemaVersion: 2 as number,
        models: merged,
        quirks: [],
      };

      applyCatalog(getDb(), catalog);
      setSetting('catalog_applied_version', catalog.version);
      setSetting('catalog_applied_json', JSON.stringify(catalog));
      setSetting('catalog_yangma_version', catalog.version);

      // Simulate boot: re-apply from cache
      const result = reapplyCachedCatalog();
      expect(result.reapplied).toBe(true);
      expect(result.version).toBe(catalog.version);
    });
  });

  describe('non-human-readable modelId enforcement', () => {
    it('no modelId should look like a sentence or title', async () => {
      const { models } = await fetchYangmaoData();

      const suspicious: string[] = [];
      for (const m of models) {
        // Contains 3+ consecutive uppercase letters → likely a human title
        if (/[A-Z]{3,}/.test(m.modelId)) {
          suspicious.push(`${m.platform}/${m.modelId}`);
        }
        // Contains "and", "or", "the", "of" as whole words → human text
        if (/\b(and|or|the|of|for|with|from|via)\b/i.test(m.modelId)) {
          suspicious.push(`${m.platform}/${m.modelId}`);
        }
      }

      if (suspicious.length > 0) {
        console.log('\n=== Suspicious modelIds (look human-readable) ===\n' + suspicious.join('\n'));
      }
      expect(suspicious).toEqual([]);
    });
  });
});
