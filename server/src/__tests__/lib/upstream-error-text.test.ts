import { describe, it, expect } from 'vitest';
import { extractUpstreamErrorText } from '../../providers/base.js';

/** Only `statusText` is read by the function under test. */
function res(statusText = 'Bad Request'): Response {
  return { status: 400, statusText } as unknown as Response;
}

/** The implementation this function replaced, copied verbatim from
 *  OpenAICompat#upstreamErrorText. It stays here as the equivalence oracle:
 *  if anyone reorders the shared shape list, the equivalence block below
 *  starts failing instead of silently changing every provider's error text. */
function legacyUpstreamErrorText(errBody: unknown, response: Response): string {
  const e = errBody as { error?: { message?: unknown }; detail?: unknown; title?: unknown };
  if (typeof e?.error?.message === 'string' && e.error.message) return e.error.message;
  if (typeof e?.detail === 'string' && e.detail) return e.detail;
  if (typeof e?.title === 'string' && e.title) return e.title;
  return response.statusText;
}

describe('extractUpstreamErrorText', () => {
  describe('shape coverage', () => {
    it('reads error.message (OpenAI-style)', () => {
      expect(extractUpstreamErrorText({ error: { message: 'rate limit exceeded' } }, res())).toBe(
        'rate limit exceeded',
      );
    });

    it('reads top-level detail (RFC7807 — NIM DEGRADED, #522)', () => {
      const body = { title: 'Bad Request', detail: "Function id 'x': DEGRADED function cannot be invoked" };
      expect(extractUpstreamErrorText(body, res())).toBe("Function id 'x': DEGRADED function cannot be invoked");
    });

    it('reads top-level title when detail is absent', () => {
      expect(extractUpstreamErrorText({ title: 'Unauthorized' }, res())).toBe('Unauthorized');
    });

    it('reads error.detail', () => {
      expect(extractUpstreamErrorText({ error: { detail: 'nested detail' } }, res())).toBe('nested detail');
    });

    it('reads errors[0].message (Cloudflare)', () => {
      expect(extractUpstreamErrorText({ errors: [{ message: 'cloudflare says no' }] }, res())).toBe(
        'cloudflare says no',
      );
    });

    it('reads top-level message (Cohere v2)', () => {
      // This is the shape that used to collapse to a bare "Bad Request".
      const body = { id: '9f1c…', message: 'invalid request: tools.0.function.parameters is malformed' };
      expect(extractUpstreamErrorText(body, res())).toBe(
        'invalid request: tools.0.function.parameters is malformed',
      );
    });

    it('falls back to statusText when the body carries nothing readable', () => {
      expect(extractUpstreamErrorText({}, res('Bad Request'))).toBe('Bad Request');
      expect(extractUpstreamErrorText({ error: {} }, res('Unauthorized'))).toBe('Unauthorized');
    });
  });

  describe('precedence', () => {
    it('prefers error.message over every other shape', () => {
      const body = { error: { message: 'a', detail: 'b' }, detail: 'c', title: 'd', message: 'e' };
      expect(extractUpstreamErrorText(body, res())).toBe('a');
    });

    it('prefers top-level detail over title (the #522 ordering)', () => {
      expect(extractUpstreamErrorText({ detail: 'd', title: 't' }, res())).toBe('d');
    });

    it('keeps the legacy three ahead of the additive shapes', () => {
      // `detail` wins over error.detail / errors[0] / message even though those
      // are "more specific" — reordering here would change live error text.
      const body = { detail: 'legacy wins', error: { detail: 'x' }, errors: [{ message: 'y' }], message: 'z' };
      expect(extractUpstreamErrorText(body, res())).toBe('legacy wins');
    });
  });

  describe('equivalence with the legacy OpenAICompat read', () => {
    // Every body the old implementation could already read must produce the
    // exact same string. Only bodies that used to fall through to statusText
    // are allowed to improve.
    const bodies: unknown[] = [
      { error: { message: 'boom' } },
      { error: { message: 'boom' }, detail: 'd', title: 't' },
      { detail: 'd' },
      { title: 't' },
      { detail: 'd', title: 't' },
      { error: { message: 'boom' }, message: 'top' },
      {},
      { error: {} },
      { error: { message: '' } },
      { detail: '' },
      { title: '' },
      { error: { message: 42 } },
      { detail: null, title: undefined },
      null,
      undefined,
      'a plain string body',
      42,
      [],
      { error: 'error is a string' },
    ];

    it('never changes a message the legacy read could already extract', () => {
      const response = res('Bad Request');
      for (const body of bodies) {
        const legacy = legacyUpstreamErrorText(body, response);
        if (legacy === response.statusText) continue; // legacy gave up; improvement allowed
        expect(extractUpstreamErrorText(body, response), `body: ${JSON.stringify(body)}`).toBe(legacy);
      }
    });

    it('always returns a non-empty string — never an empty message', () => {
      const response = res('Bad Request');
      for (const body of bodies) {
        const next = extractUpstreamErrorText(body, response);
        expect(next.length, `body: ${JSON.stringify(body)}`).toBeGreaterThan(0);
      }
    });
  });

  describe('hostile and empty bodies', () => {
    it('survives non-object bodies', () => {
      expect(extractUpstreamErrorText(null, res('X'))).toBe('X');
      expect(extractUpstreamErrorText(undefined, res('X'))).toBe('X');
      expect(extractUpstreamErrorText('nope', res('X'))).toBe('X');
      expect(extractUpstreamErrorText(0, res('X'))).toBe('X');
      expect(extractUpstreamErrorText([{ message: 'in array' }], res('X'))).toBe('X');
    });

    it('ignores a non-object error field', () => {
      expect(extractUpstreamErrorText({ error: 'just a string', message: 'top' }, res())).toBe('top');
    });

    it('ignores an errors array that is empty or malformed', () => {
      expect(extractUpstreamErrorText({ errors: [] }, res('X'))).toBe('X');
      expect(extractUpstreamErrorText({ errors: 'not an array' }, res('X'))).toBe('X');
      expect(extractUpstreamErrorText({ errors: [{}] }, res('X'))).toBe('X');
      expect(extractUpstreamErrorText({ errors: [{ message: 7 }] }, res('X'))).toBe('X');
    });

    it('treats whitespace-only strings as present, matching the legacy acceptance test', () => {
      // The old check was `typeof v === 'string' && v`, so "   " was accepted.
      // Keeping that exact rule avoids changing error text over whitespace.
      expect(extractUpstreamErrorText({ error: { message: '   ' } }, res())).toBe('   ');
    });
  });

  describe('regressions this unifies', () => {
    it('#522 — NVIDIA NIM DEGRADED marker stays readable', () => {
      const body = { title: 'Bad Request', detail: "Function id 'meta/llama': DEGRADED function cannot be invoked" };
      expect(extractUpstreamErrorText(body, res())).toContain('DEGRADED');
    });

    it('#268 — Google API key rejection keeps its message', () => {
      const body = { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } };
      expect(extractUpstreamErrorText(body, res())).toBe('API key not valid. Please pass a valid API key.');
    });

    it('Cohere 400 now reports a cause instead of "Bad Request"', () => {
      const body = { id: 'abc', message: 'invalid request: this model is not supported with /v1/chat' };
      expect(legacyUpstreamErrorText(body, res())).toBe('Bad Request'); // before
      expect(extractUpstreamErrorText(body, res())).toBe(
        'invalid request: this model is not supported with /v1/chat', // after
      );
    });

    it('Cloudflare keeps errors[0].message when error.message is absent', () => {
      const body = { success: false, errors: [{ code: 1000, message: 'Authentication error' }] };
      expect(extractUpstreamErrorText(body, res())).toBe('Authentication error');
    });
  });
});
