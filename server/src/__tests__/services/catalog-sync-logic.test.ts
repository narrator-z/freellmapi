// parseRateLimit, normalizeModelName, mergeCatalogs, parseContext, toSlug
// were removed in the switch to the freellmapi-augmented single-source catalog.
// The augmented catalog is pre-parsed JSON — no string parsing or merging needed.
// Core applyCatalog and sync lifecycle tests live in catalog-sync.test.ts.
