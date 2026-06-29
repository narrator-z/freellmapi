import { describe, it } from 'vitest';

// fetchYangmaoData, toSlug, mergeRankings were removed in the switch to the
// freellmapi-augmented single-source catalog.
// The augmented catalog is pre-parsed JSON -- no slugification or ranking merge needed.
// Core applyCatalog and sync lifecycle tests live in catalog-sync.test.ts.

describe('yangmao catalog pipeline (deprecated)', () => {
  it('placeholder', () => {});
});
