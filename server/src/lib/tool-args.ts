// Schema-aware repair of double-encoded tool-call arguments.
//
// Several free-tier models (GLM family prominently) emit NESTED JSON inside
// tool arguments as a string: `{"plan": "[{\"step\":...}]"}` instead of
// `{"plan": [{"step":...}]}`. Strict clients reject the call — observed in
// production as Codex `failed to parse function arguments: invalid type:
// string ..., expected a sequence`, which killed the agent turn right at its
// status-update call. The gateway has the request's tool schemas, so it can
// repair this principled-ly: only when the schema says a parameter is an
// array/object AND the string value parses to exactly that JSON type. A
// parameter whose schema says "string" is never touched, even if it looks
// like JSON.
//
// The walk is recursive. A model that stringifies a top-level array
// stringifies a nested one too, and a repair that stopped at the top level
// left `{"config": {"tags": "[\"a\"]"}}` broken for the client. Each level
// re-applies the identical gate, so depth adds reach without adding latitude:
// still never a guess, still never a coercion, still nothing invented.
//
// Also handles whole-arguments double encoding (the arguments field itself
// being a JSON-encoded string of a JSON object), which needs no schema.

interface JsonSchemaish {
  type?: string;
  properties?: Record<string, JsonSchemaish>;
  // `items` lets the walk descend into arrays. A tuple form (an array of
  // per-position schemas) is deliberately not followed: matching a decoded
  // element to its position is exactly the kind of inference that turns a
  // repair into a guess.
  items?: JsonSchemaish;
}

/**
 * Repair a tool call's `arguments` JSON string against the tool's parameter
 * schema. Returns the original string untouched whenever anything doesn't
 * parse or doesn't match — this must never corrupt a valid call.
 */
export function repairToolArguments(args: string, paramSchema?: JsonSchemaish): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(args);
  } catch {
    return args;
  }

  let changed = false;

  // Whole-arguments double encoding: `"{\"a\":1}"` parses to a string that is
  // itself JSON of an object. Unwrap one level.
  if (typeof parsed === 'string') {
    try {
      const inner = JSON.parse(parsed);
      if (inner !== null && typeof inner === 'object' && !Array.isArray(inner)) {
        parsed = inner;
        changed = true;
      } else {
        return args;
      }
    } catch {
      return args;
    }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return changed ? JSON.stringify(parsed) : args;
  }

  if (repairInPlace(parsed, paramSchema)) changed = true;

  return changed ? JSON.stringify(parsed) : args;
}

/**
 * Decode `value` against the schema node that describes it, or return
 * `undefined` to mean "leave it alone".
 *
 * The gate is the whole design: the schema must say `array` or `object`, and
 * the string must parse to exactly that. A parameter whose schema says
 * `string` is never touched even when it looks like JSON, an absent or
 * type-less schema node is never guessed at, and a mismatch is left as-is
 * rather than coerced.
 */
function decodeIfSchemaSays(value: string, schema: JsonSchemaish | undefined): unknown | undefined {
  const want = schema?.type;
  if (want !== 'array' && want !== 'object') return undefined;
  const trimmed = value.trim();
  if (!(trimmed.startsWith('[') || trimmed.startsWith('{'))) return undefined;
  try {
    const inner = JSON.parse(trimmed);
    const isMatch = want === 'array'
      ? Array.isArray(inner)
      : inner !== null && typeof inner === 'object' && !Array.isArray(inner);
    return isMatch ? inner : undefined;
  } catch {
    // Not actually JSON — leave the string alone.
    return undefined;
  }
}

/**
 * Walk a decoded value alongside its schema, decoding double-encoded strings
 * wherever the schema is unambiguous. Mutates `node` in place (it is always a
 * fresh JSON.parse result, never a caller's object) and reports whether
 * anything changed.
 *
 * Recursion is the point: the same model that stringifies a top-level array
 * stringifies a nested one, and until now only the top level was repaired, so
 * `{"config": {"tags": "[\"a\"]"}}` reached the client still broken. Each
 * level re-applies the identical gate, so depth adds reach without loosening
 * the rule — a newly decoded value is itself walked, since a doubly-wrapped
 * payload is exactly what the models that do this produce.
 */
function repairInPlace(node: unknown, schema: JsonSchemaish | undefined): boolean {
  if (node === null || typeof node !== 'object') return false;

  let changed = false;

  if (Array.isArray(node)) {
    // One `items` schema describes every element; a tuple schema is skipped
    // by the type on JsonSchemaish.
    const itemSchema = schema?.items;
    if (!itemSchema) return false;
    for (let i = 0; i < node.length; i++) {
      const value = node[i];
      if (typeof value === 'string') {
        const decoded = decodeIfSchemaSays(value, itemSchema);
        if (decoded !== undefined) {
          node[i] = decoded;
          changed = true;
          repairInPlace(decoded, itemSchema);
        }
      } else if (repairInPlace(value, itemSchema)) {
        changed = true;
      }
    }
    return changed;
  }

  const props = schema?.properties;
  if (!props) return false;

  const obj = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    const child = props[key];
    if (!child) continue; // Unknown key — no schema to justify a change.
    if (typeof value === 'string') {
      const decoded = decodeIfSchemaSays(value, child);
      if (decoded !== undefined) {
        obj[key] = decoded;
        changed = true;
        repairInPlace(decoded, child);
      }
    } else if (repairInPlace(value, child)) {
      changed = true;
    }
  }

  return changed;
}

/**
 * Recursively remove the given keys from a JSON-Schema-ish value. Used to drop
 * fields a provider's tool-schema validator rejects with a 400 even though they
 * carry no meaning for the call — Cohere's compat endpoint, for instance, 400s
 * on `additionalProperties` (and `$schema`), which strict clients like opencode
 * and continue.dev routinely emit. Returns a NEW value; never mutates the input
 * (tools are shared across the fallback chain, so an in-place strip on one
 * provider would corrupt the schema the next provider sees). Non-object values
 * pass through unchanged. This is the provider-agnostic sibling of google.ts's
 * `sanitizeForGemini`, which strips a much larger Gemini-specific key set.
 */
export function stripSchemaKeys<T>(schema: T, keys: Set<string>): T {
  if (Array.isArray(schema)) {
    return schema.map((s) => stripSchemaKeys(s, keys)) as unknown as T;
  }
  if (schema && typeof schema === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
      if (keys.has(k)) continue;
      out[k] = stripSchemaKeys(v, keys);
    }
    return out as unknown as T;
  }
  return schema;
}

/**
 * How aggressively a provider's tool schemas are cleaned before being sent.
 *
 * The ladder exists because a provider that REJECTS a tool schema is otherwise
 * indistinguishable from a provider that rejects the request: both answer 400,
 * so the chain burns a failover hop and the caller sees
 * "all providers rejected the request as invalid". Each rung removes more of
 * the surface a strict validator can choke on.
 *
 *   L0 — send the schema exactly as the client wrote it. The default for every
 *        provider: opting a provider in is a deliberate, reviewable act.
 *   L1 — drop keywords that carry no validation meaning for a tool call. Safe
 *        enough to send on the FIRST attempt for a provider that opts in; the
 *        model still sees every constraint that governs the arguments.
 *   L2 — keep only the minimum set a validator needs (`type`, `properties`,
 *        `required`, `items`, `description`, `enum`). This can drop real
 *        structure (`anyOf`, `oneOf`, `pattern`, …), so it is a last resort,
 *        used only after a stricter rung was already rejected.
 */
export type SchemaSanitizeLevel = 'L0' | 'L1' | 'L2';

/** Keywords that never change which arguments are valid, so dropping them
 *  cannot change what the model is asked to produce — only what a pedantic
 *  validator can object to. `$schema` and `additionalProperties` head the list
 *  because Cohere's compat endpoint 400s on exactly those two (#multi-fork). */
const L1_DROPPED_SCHEMA_KEYS: ReadonlySet<string> = new Set([
  '$schema',
  'additionalProperties',
  'default',
  'examples',
  'example',
  'title',
  '$comment',
  'readOnly',
  'writeOnly',
  'deprecated',
]);

/** The L2 keep-list. Anything not named here is dropped. */
const L2_KEPT_SCHEMA_KEYS: ReadonlySet<string> = new Set([
  'type',
  'properties',
  'required',
  'items',
  'description',
  'enum',
]);

/** The next, more aggressive rung, or undefined at the bottom of the ladder.
 *  Drives the single-shot downgrade retry: no caller has to know the order. */
export function nextSanitizeLevel(level: SchemaSanitizeLevel): SchemaSanitizeLevel | undefined {
  if (level === 'L0') return 'L1';
  if (level === 'L1') return 'L2';
  return undefined;
}

/** Sanitize a `properties` map. Its KEYS are user-defined property names, not
 *  schema keywords, so they must all survive — only the values are schemas.
 *  (Filtering them against a keep-list silently deletes every property.) */
function sanitizePropertyMap(map: unknown, level: SchemaSanitizeLevel): unknown {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return map;
  const out: Record<string, unknown> = {};
  for (const [name, sub] of Object.entries(map as Record<string, unknown>)) {
    out[name] = sanitizeSchema(sub, level);
  }
  return out;
}

function sanitizeSchema(schema: unknown, level: SchemaSanitizeLevel): unknown {
  if (level === 'L0') return schema;
  if (Array.isArray(schema)) return schema.map((s) => sanitizeSchema(s, level));
  if (!schema || typeof schema !== 'object') return schema;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (level === 'L1') {
      if (L1_DROPPED_SCHEMA_KEYS.has(k)) continue;
      out[k] = sanitizeSchema(v, level);
      continue;
    }

    // L2: keep-list, plus two special cases.
    if (!L2_KEPT_SCHEMA_KEYS.has(k)) continue;
    // An empty `required` is itself a rejection trigger for some validators,
    // and it asserts nothing anyway.
    if (k === 'required' && Array.isArray(v) && v.length === 0) continue;
    // `properties` holds user-defined names and `enum`/`required` hold literal
    // values — neither is schema vocabulary, so neither may be filtered.
    if (k === 'properties') out[k] = sanitizePropertyMap(v, level);
    else if (k === 'enum' || k === 'required') out[k] = v;
    else out[k] = sanitizeSchema(v, level);
  }
  return out;
}

/**
 * Apply a sanitize level to a whole tools array, returning NEW objects.
 * Never mutates: `tools` is shared by every candidate in the fallback chain, so
 * an in-place strip would silently degrade the schema for the providers tried
 * later. L0 returns the input array itself (no change, no allocation).
 */
export function sanitizeToolsForProvider<T extends { function?: { parameters?: unknown } }>(
  tools: T[] | undefined,
  level: SchemaSanitizeLevel,
): T[] | undefined {
  if (!tools || tools.length === 0 || level === 'L0') return tools;
  return tools.map((t) =>
    t.function?.parameters
      ? { ...t, function: { ...t.function, parameters: sanitizeSchema(t.function.parameters, level) } }
      : t,
  );
}

/**
 * Build a tool-name → parameter-schema map from an OpenAI-style tools array
 * (chat-completions shape: {type:'function', function:{name, parameters}}).
 */
export function toolSchemaMap(
  tools?: Array<{ type?: string; function?: { name?: string; parameters?: unknown } }>,
): Map<string, JsonSchemaish> {
  const map = new Map<string, JsonSchemaish>();
  for (const t of tools ?? []) {
    const name = t.function?.name;
    if (t.type === 'function' && name && t.function?.parameters && typeof t.function.parameters === 'object') {
      map.set(name, t.function.parameters as JsonSchemaish);
    }
  }
  return map;
}
