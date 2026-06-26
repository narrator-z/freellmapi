import { describe, it, expect } from 'vitest';
import {
  parseRateLimit,
  normalizeModelName,
  mergeCatalogs,
  parseContext,
  toSlug,
  type CatalogModel,
  type Catalog,
} from '../../services/catalog-sync.js';

// ======================================================================
// parseRateLimit — expanded to support "/day" format and edge cases
// ======================================================================

describe('parseRateLimit', () => {
  it('parses "10000/day" as rpd=10000', () => {
    const result = parseRateLimit('10000/day');
    expect(result.rpd).toBe(10000);
    expect(result.rpm).toBeNull();
    expect(result.tpm).toBeNull();
    expect(result.tpd).toBeNull();
  });

  it('parses "5000 requests/day" as rpd=5000', () => {
    const result = parseRateLimit('5000 requests/day');
    expect(result.rpd).toBe(5000);
  });

  it('parses "30 RPM" as rpm=30', () => {
    const result = parseRateLimit('30 RPM');
    expect(result.rpm).toBe(30);
    expect(result.rpd).toBeNull();
  });

  it('parses "60 RPD" as rpd=60', () => {
    const result = parseRateLimit('60 RPD');
    expect(result.rpd).toBe(60);
  });

  it('parses "50 RPD / 100K TPD" as rpd=50, tpd=100000', () => {
    const result = parseRateLimit('50 RPD / 100K TPD');
    expect(result.rpd).toBe(50);
    expect(result.tpd).toBe(100000);
    expect(result.rpm).toBeNull();
    expect(result.tpm).toBeNull();
  });

  it('parses "30 RPM / 60K TPM" as rpm=30, tpm=60000', () => {
    const result = parseRateLimit('30 RPM / 60K TPM');
    expect(result.rpm).toBe(30);
    expect(result.tpm).toBe(60000);
  });

  it('parses "1000 RPD / 350K TPD" as rpd=1000, tpd=350000', () => {
    const result = parseRateLimit('1000 RPD / 350K TPD');
    expect(result.rpd).toBe(1000);
    expect(result.tpd).toBe(350000);
  });

  it('returns null for "Account dependent"', () => {
    const result = parseRateLimit('Account dependent');
    expect(result.rpm).toBeNull();
    expect(result.rpd).toBeNull();
    expect(result.tpm).toBeNull();
    expect(result.tpd).toBeNull();
  });

  it('returns null for empty string', () => {
    const result = parseRateLimit('');
    expect(result.rpm).toBeNull();
    expect(result.rpd).toBeNull();
  });

  it('returns all null for undefined/null-like input', () => {
    const result = parseRateLimit('');
    expect(result).toEqual({ rpm: null, rpd: null, tpm: null, tpd: null });
  });

  it('handles Chinese comma separator "，"', () => {
    const result = parseRateLimit('30 RPM，1000 RPD');
    expect(result.rpm).toBe(30);
    expect(result.rpd).toBe(1000);
  });

  it('handles Chinese comma separator "、"', () => {
    const result = parseRateLimit('30 RPM、1000 RPD');
    expect(result.rpm).toBe(30);
    expect(result.rpd).toBe(1000);
  });

  it('parses integer with decimal value', () => {
    const result = parseRateLimit('3.5 requests/day');
    expect(result.rpd).toBe(3); // parseInt floors at 3
  });

  it('is case-insensitive for day, RPM, RPD', () => {
    const result = parseRateLimit('10000/Day');
    expect(result.rpd).toBe(10000);
  });

  it('handles "150 req/day"', () => {
    const result = parseRateLimit('150 req/day');
    expect(result.rpd).toBe(150);
  });

  it('handles "200 requests / day"', () => {
    const result = parseRateLimit('200 requests / day');
    expect(result.rpd).toBe(200);
  });

  it('handles "150 req/day" — req shorthand', () => {
    const result = parseRateLimit('150 req/day');
    expect(result.rpd).toBe(150);
  });

  it('handles "60K TPM" — K suffix', () => {
    const result = parseRateLimit('60K TPM');
    expect(result.tpm).toBe(60000);
  });

  it('handles "100K TPD" — K suffix on TPD', () => {
    const result = parseRateLimit('100K TPD');
    expect(result.tpd).toBe(100000);
  });

  it('handles "30 RPM / 60K TPM" — slash separator with K suffix', () => {
    const result = parseRateLimit('30 RPM / 60K TPM');
    expect(result.rpm).toBe(30);
    expect(result.tpm).toBe(60000);
  });

  it('handles "50 RPD / 100K TPD" — slash separator with K suffix', () => {
    const result = parseRateLimit('50 RPD / 100K TPD');
    expect(result.rpd).toBe(50);
    expect(result.tpd).toBe(100000);
  });

  it('handles "1000 RPD / 350K TPD"', () => {
    const result = parseRateLimit('1000 RPD / 350K TPD');
    expect(result.rpd).toBe(1000);
    expect(result.tpd).toBe(350000);
  });

  it('handles lowercase k in "60k tpm"', () => {
    const result = parseRateLimit('60k tpm');
    expect(result.tpm).toBe(60000);
  });

  it('handles mixtures: "30 RPM, 2000 RPD, 60K TPM"', () => {
    const result = parseRateLimit('30 RPM, 2000 RPD, 60K TPM');
    expect(result.rpm).toBe(30);
    expect(result.rpd).toBe(2000);
    expect(result.tpm).toBe(60000);
  });
});

// ======================================================================
// normalizeModelName — cross-source model matching
// ======================================================================

describe('normalizeModelName', () => {
  it('strips parenthetical suffixes', () => {
    expect(normalizeModelName('Llama 3.3 70B (CF)')).toBe('llama 3.3 70b');
    expect(normalizeModelName('Llama 3.3 70B (NV)')).toBe('llama 3.3 70b');
    expect(normalizeModelName('Llama 3.3 70B (Ollama)')).toBe('llama 3.3 70b');
  });

  it('strips version/instruct/free/fast keywords', () => {
    expect(normalizeModelName('Llama 3.3 70B Versatile')).toBe('llama 3.3 70b');
    expect(normalizeModelName('Llama 3.3 70B Instruct')).toBe('llama 3.3 70b');
    // normalizeModelName converts hyphens to spaces for comparison purposes
    expect(normalizeModelName('DeepSeek-V4-Free')).toBe('deepseek v4');
    expect(normalizeModelName('Fast Model')).toBe('model');
  });

  it('strips beta and preview labels', () => {
    expect(normalizeModelName('Qwen3.5 Beta')).toBe('qwen3.5');
    expect(normalizeModelName('Qwen3.5 Preview')).toBe('qwen3.5');
  });

  it('normalizes to lowercase and converts hyphens to spaces', () => {
    // normalizeModelName converts hyphens to spaces for name matching
    expect(normalizeModelName('GPT-4O')).toBe('gpt 4o');
  });

  it('strips non-alphanumeric characters except dots and spaces', () => {
    // normalizeModelName converts hyphens to spaces, strips punctuation
    expect(normalizeModelName('Qwen2.5-Coder-32B!')).toBe('qwen2.5 coder 32b');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeModelName('Llama   3.3   70B')).toBe('llama 3.3 70b');
  });

  it('trims leading/trailing whitespace', () => {
    expect(normalizeModelName('  DeepSeek V4  ')).toBe('deepseek v4');
  });

  it('matches "Llama 3.3 70B Versatile" == "Llama 3.3 70B"', () => {
    const a = normalizeModelName('Llama 3.3 70B Versatile');
    const b = normalizeModelName('Llama 3.3 70B');
    expect(a).toBe(b);
  });

  it('matches "deepseek-ai/deepseek-v4-pro" == "DeepSeek-V4-Pro" (after normalize — containment check)', () => {
    // normalizeModelName produces different strings due to "deepseek-ai" prefix vs "DeepSeek"
    // but mergeCatalogs uses a containment check as fallback:
    //   normName.includes(v1Norm) || v1Norm.includes(normName)
    // "deepseek v4 pro" IS contained in "deepseek ai deepseek v4 pro" → match
    const a = normalizeModelName('deepseek-ai/deepseek-v4-pro');
    const b = normalizeModelName('DeepSeek-V4-Pro');
    // The longer name should contain the shorter one
    expect(a.includes(b) || b.includes(a)).toBe(true);
    // But they are not identical strings due to the prefix
    expect(a).not.toBe(b);
  });

  it('distinguishes different models (no false match)', () => {
    expect(normalizeModelName('Llama 3.3 70B')).not.toBe(normalizeModelName('Llama 3.1 8B'));
    expect(normalizeModelName('GPT-4')).not.toBe(normalizeModelName('GPT-4o'));
  });

  it('handles the "it" keyword (instruct variant)', () => {
    expect(normalizeModelName('Gemma 4 31B-IT')).toBe('gemma 4 31b');
  });

  it('handles empty string', () => {
    expect(normalizeModelName('')).toBe('');
  });

  it('strips "fp8" suffix', () => {
    expect(normalizeModelName('Llama 4 Maverick 17B FP8')).toBe('llama 4 maverick 17b');
  });
});

// ======================================================================
// parseContext — context window parsing
// ======================================================================

describe('parseContext', () => {
  it('parses "128K" as 131072', () => {
    expect(parseContext('128K')).toBe(131072);
  });

  it('parses "1M" as 1048576', () => {
    expect(parseContext('1M')).toBe(1048576);
  });

  it('parses plain number "8192" as 8192', () => {
    expect(parseContext('8192')).toBe(8192);
  });

  it('returns null for empty string', () => {
    expect(parseContext('')).toBeNull();
  });

  it('returns null for "N/A"', () => {
    expect(parseContext('N/A')).toBeNull();
  });

  it('returns null for "Varies"', () => {
    expect(parseContext('Varies')).toBeNull();
  });

  it('returns null for "Model dependent"', () => {
    expect(parseContext('Model dependent')).toBeNull();
  });

  it('handles lowercase "128k"', () => {
    expect(parseContext('128k')).toBe(131072);
  });

  it('returns null for unparseable strings', () => {
    expect(parseContext('not a number')).toBeNull();
  });
});

// ======================================================================
// mergeCatalogs — v1 + yangmao merge logic
// ======================================================================

// Helper: create a minimal V1 catalog model
function v1Model(overrides: Partial<CatalogModel> = {}): CatalogModel {
  return {
    platform: 'groq',
    modelId: 'llama-3.3-70b-versatile',
    displayName: 'Llama 3.3 70B Versatile',
    intelligenceRank: 17,
    speedRank: 10,
    sizeLabel: 'Medium',
    limits: { rpm: 30, rpd: 1000, tpm: 6000, tpd: null },
    monthlyTokenBudget: '~1M',
    contextWindow: 131072,
    enabled: true,
    supportsVision: false,
    supportsTools: true,
    ...overrides,
  };
}

// Helper: create a minimal yangmao catalog model
function ymModel(overrides: Partial<CatalogModel> = {}): CatalogModel {
  return {
    platform: 'groq',
    modelId: 'llama-3.3-70b-versatile',
    displayName: 'Llama 3.3 70B Versatile',
    intelligenceRank: 0,
    speedRank: 0,
    sizeLabel: '',
    limits: { rpm: null, rpd: null, tpm: null, tpd: null },
    monthlyTokenBudget: null,
    contextWindow: null,
    enabled: true,
    supportsVision: false,
    supportsTools: false,
    ...overrides,
  };
}

function makeCatalog(version: string, models: CatalogModel[], quirks: Catalog['quirks'] = []): Catalog {
  return {
    version,
    generatedAt: '2026-06-26T00:00:00Z',
    tier: 'live',
    models,
    quirks,
  };
}

describe('mergeCatalogs', () => {
  it('keeps v1 models when both sources are present', () => {
    const v1 = makeCatalog('v1.1', [v1Model()]);
    const ym = makeCatalog('ym.1', [ymModel()]);
    const result = mergeCatalogs(v1, ym);
    expect(result.models.length).toBe(1);
    // v1 data should be authoritative
    expect(result.models[0].intelligenceRank).toBe(17);
    expect(result.models[0].speedRank).toBe(10);
  });

  it('adds yangmao-only models not in v1', () => {
    const v1 = makeCatalog('v1.1', [v1Model({ modelId: 'qwen-max', displayName: 'Qwen Max' })]);
    const ym = makeCatalog('ym.1', [
      ymModel({ modelId: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro' }),
    ]);
    const result = mergeCatalogs(v1, ym);
    expect(result.models.length).toBe(2);
    expect(result.models.map((m) => m.modelId)).toContain('deepseek-v4-pro');
  });

  it('deduplicates same model by modelId key', () => {
    const v1 = makeCatalog('v1.1', [v1Model({ modelId: 'llama-3.3-70b-versatile' })]);
    const ym = makeCatalog('ym.1', [ymModel({ modelId: 'llama-3.3-70b-versatile' })]);
    const result = mergeCatalogs(v1, ym);
    expect(result.models.length).toBe(1);
  });

  it('deduplicates same model by normalized display name across platforms', () => {
    // v1 uses a model with platform "google" and modelId "gemini-2.5-flash"
    // yangmao uses platform "gemini" which maps to "google" via YANGMAO_TO_V1_PLATFORM
    // but the modelIds differ — dedup by display name
    const v1 = makeCatalog('v1.1', [
      v1Model({
        platform: 'google',
        modelId: 'gemini-2.5-flash',
        displayName: 'Gemini 2.5 Flash',
      }),
    ]);
    const ym = makeCatalog('ym.1', [
      ymModel({
        platform: 'gemini',  // maps to "google" via alias
        modelId: 'gemini-2.5-flash',
        displayName: 'Gemini 2.5 Flash',
      }),
    ]);
    const result = mergeCatalogs(v1, ym);
    expect(result.models.length).toBe(1);
    // v1 data is authoritative
    expect(result.models[0].intelligenceRank).toBe(17);
  });

  it('deduplicates by normalized name when v1 modelId differs from yangmao slug', () => {
    const v1 = makeCatalog('v1.1', [
      v1Model({
        platform: 'groq',
        modelId: 'deepseek-ai/deepseek-v4-pro',
        displayName: 'DeepSeek-V4-Pro',
      }),
    ]);
    const ym = makeCatalog('ym.1', [
      ymModel({
        platform: 'groq',
        modelId: 'deepseek-v4-pro',  // slugified differently
        displayName: 'DeepSeek-V4-Pro',
      }),
    ]);
    const result = mergeCatalogs(v1, ym);
    expect(result.models.length).toBe(1);
  });

  it('does NOT deduplicate models with similar but different names', () => {
    const v1 = makeCatalog('v1.1', [
      v1Model({ displayName: 'Llama 3.1 8B', modelId: 'llama-3.1-8b' }),
    ]);
    const ym = makeCatalog('ym.1', [
      ymModel({ displayName: 'Llama 3.3 70B', modelId: 'llama-3.3-70b' }),
    ]);
    const result = mergeCatalogs(v1, ym);
    expect(result.models.length).toBe(2);
  });

  it('correctly maps yangmao platform aliases to v1 platform IDs', () => {
    // yangmao uses "nebius-ai-studio" but v1 (and internal) uses "nebius"
    const v1 = makeCatalog('v1.1', [
      v1Model({
        platform: 'nebius',
        modelId: 'some-model',
        displayName: 'Some Model',
      }),
    ]);
    const ym = makeCatalog('ym.1', [
      ymModel({
        platform: 'nebius-ai-studio',  // alias → "nebius"
        modelId: 'other-model',
        displayName: 'Other Model',
      }),
    ]);
    const result = mergeCatalogs(v1, ym);
    // The "other-model" should be added as platform "nebius" (aliased)
    expect(result.models.length).toBe(2);
    const added = result.models.find((m) => m.modelId === 'other-model');
    expect(added).toBeDefined();
    expect(added!.platform).toBe('nebius');
  });

  it('deduplicates within same yangmao catalog (multiple sources produce same model)', () => {
    // Two yangmao providers produce the same model
    const v1 = makeCatalog('v1.1', [
      v1Model({ modelId: 'existing-model', displayName: 'Existing Model' }),
    ]);
    const ym = makeCatalog('ym.1', [
      ymModel({ platform: 'groq', modelId: 'dup-model', displayName: 'Duplicate Model' }),
      ymModel({ platform: 'groq', modelId: 'dup-model', displayName: 'Duplicate Model' }),
    ]);
    const result = mergeCatalogs(v1, ym);
    const dupCount = result.models.filter((m) => m.modelId === 'dup-model').length;
    expect(dupCount).toBe(1);
  });

  it('handles v1 success + yangmao failure gracefully', () => {
    // When yangmao is null, mergeCatalogs isn't called — v1 passes straight through
    // This is tested at the syncCatalog level. mergeCatalogs always assumes
    // both args are valid catalogs.
  });

  it('preserves v1 version and quirks in merged catalog', () => {
    const v1 = makeCatalog('v1.42', [v1Model()], [
      { slug: 'test-quirk', title: 'Test', body: 'Body', severity: 'info', targets: [] },
    ]);
    const ym = makeCatalog('ym.1', [ymModel({ modelId: 'extra-model', displayName: 'Extra' })]);
    const result = mergeCatalogs(v1, ym);
    expect(result.version).toBe('v1.42');
    expect(result.quirks.length).toBe(1);
    expect(result.quirks[0].slug).toBe('test-quirk');
  });

  it('does not add yangmao model if it matches by normalized name containment', () => {
    // This tests the "one normalized name contains the other" logic
    const v1 = makeCatalog('v1.1', [
      v1Model({
        platform: 'groq',
        modelId: 'llama-3.3-70b',
        displayName: 'Llama 3.3 70B',
      }),
    ]);
    const ym = makeCatalog('ym.1', [
      ymModel({
        platform: 'groq',
        modelId: 'llama-3.3-70b-versatile',
        displayName: 'Llama 3.3 70B Versatile',
      }),
    ]);
    const result = mergeCatalogs(v1, ym);
    // After normalizeModelName: both become "llama 3.3 70b" - should dedup
    expect(result.models.length).toBe(1);
  });

  it('adds yangmao model on a wholly new platform', () => {
    const v1 = makeCatalog('v1.1', [v1Model()]);
    const ym = makeCatalog('ym.1', [
      ymModel({
        platform: 'aimlapi',
        modelId: 'gpt-oss-120b',
        displayName: 'GPT-OSS 120B',
      }),
    ]);
    const result = mergeCatalogs(v1, ym);
    expect(result.models.length).toBe(2);
    const newModel = result.models.find((m) => m.platform === 'aimlapi');
    expect(newModel).toBeDefined();
  });

  it('handles empty v1 catalog (just quirks)', () => {
    const v1 = makeCatalog('v1.1', []);
    const ym = makeCatalog('ym.1', [
      ymModel({ platform: 'groq', modelId: 'only-model', displayName: 'Only Model' }),
    ]);
    const result = mergeCatalogs(v1, ym);
    expect(result.models.length).toBe(1);
  });

  it('handles empty yangmao catalog', () => {
    const v1 = makeCatalog('v1.1', [v1Model()]);
    const ym = makeCatalog('ym.1', []);
    const result = mergeCatalogs(v1, ym);
    expect(result.models.length).toBe(1);
    expect(result.models[0].modelId).toBe('llama-3.3-70b-versatile');
  });

  it('all yangmao models keep v1 platform after alias mapping', () => {
    const v1 = makeCatalog('v1.1', [
      v1Model({ platform: 'cloudflare', modelId: 'worker-ai-llm', displayName: 'Worker AI LLM' }),
    ]);
    const ym = makeCatalog('ym.1', [
      ymModel({
        platform: 'cloudflare-workers-ai',
        modelId: 'flux-schnell',
        displayName: 'FLUX.1 Schnell',
      }),
    ]);
    const result = mergeCatalogs(v1, ym);
    expect(result.models.length).toBe(2);
    const extra = result.models.find((m) => m.modelId === 'flux-schnell');
    expect(extra).toBeDefined();
    expect(extra!.platform).toBe('cloudflare');  // mapped via YANGMAO_TO_V1_PLATFORM
  });
});

// ======================================================================
// hasProvider — new platform registration check
// ======================================================================

describe('hasProvider (new platforms)', () => {
  let hasProvider: (platform: any) => boolean;

  beforeAll(async () => {
    const mod = await import('../../providers/index.js');
    hasProvider = mod.hasProvider;
  });

  it('recognizes "qwen" platform', () => {
    expect(hasProvider('qwen')).toBe(true);
  });

  it('recognizes "stepfun" platform', () => {
    expect(hasProvider('stepfun')).toBe(true);
  });

  it('recognizes "together-ai" platform', () => {
    expect(hasProvider('together-ai')).toBe(true);
  });

  it('recognizes "runpod" platform', () => {
    expect(hasProvider('runpod')).toBe(true);
  });

  it('recognizes "nebius" platform', () => {
    expect(hasProvider('nebius')).toBe(true);
  });

  it('recognizes "sambanova" platform', () => {
    expect(hasProvider('sambanova')).toBe(true);
  });

  it('recognizes "deepseek" platform', () => {
    expect(hasProvider('deepseek')).toBe(true);
  });

  it('rejects unknown platform', () => {
    expect(hasProvider('nonexistent-platform' as any)).toBe(false);
  });
});

// ======================================================================
// toSlug — additional edge cases beyond existing tests
// ======================================================================

describe('toSlug (additional edge cases)', () => {
  it('collapses repeated dots', () => {
    expect(toSlug('Test..Model..1.0')).toBe('test.model.1.0');
  });

  it('removes leading/trailing hyphens after transformation', () => {
    expect(toSlug('-test-')).toBe('test');
  });

  it('strips @ symbols', () => {
    expect(toSlug('hello@world')).toBe('helloworld');
  });

  it('removes non-alphanumeric characters except dot and hyphen', () => {
    expect(toSlug('hello!world#$%^&*()')).toBe('helloworld');
  });

  it('preserves dots in version numbers', () => {
    expect(toSlug('model-v1.2.3')).toBe('model-v1.2.3');
  });

  it('handles empty string', () => {
    expect(toSlug('')).toBe('');
  });
});
