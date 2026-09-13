import { describe, it, expect, vi, beforeEach } from 'vitest';

// Quota recording is observable only through the module, and "no double
// counting across a downgrade retry" is an explicit acceptance criterion.
const { recordQuota } = vi.hoisted(() => ({ recordQuota: vi.fn() }));
vi.mock('../../services/provider-quota.js', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, recordQuotaObservationsFromResponse: recordQuota };
});

import { CohereProvider } from '../../providers/cohere.js';

describe('CohereProvider', () => {
  let provider: CohereProvider;

  beforeEach(() => {
    provider = new CohereProvider();
  });

  it('should have correct platform and name', () => {
    expect(provider.platform).toBe('cohere');
    expect(provider.name).toBe('Cohere');
  });

  it('should call compatibility API and return OpenAI response', async () => {
    let capturedUrl = '';
    let capturedBody: any = null;
    vi.spyOn(global, 'fetch').mockImplementationOnce(async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse((init as any).body);
      return {
        ok: true,
        json: () => Promise.resolve({
          id: 'cohere-123',
          object: 'chat.completion',
          created: 123,
          model: 'command-a-03-2025',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Hello from Cohere!' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      } as any;
    });

    const result = await provider.chatCompletion(
      'test-key',
      [{ role: 'user', content: 'Hi' }],
      'command-r-plus-08-2024',
      {
        tools: [{
          type: 'function',
          function: {
            name: 'get_weather',
            parameters: {
              type: 'object',
              properties: { city: { type: 'string' } },
            },
          },
        }],
      },
    );

    expect(capturedUrl).toContain('/compatibility/v1/chat/completions');
    expect(capturedBody.tools).toHaveLength(1);
    expect(result.object).toBe('chat.completion');
    expect(result.choices[0].message.content).toBe('Hello from Cohere!');
    expect(result.usage.prompt_tokens).toBe(10);
    expect(result.usage.completion_tokens).toBe(5);
    expect(result._routed_via?.platform).toBe('cohere');
  });

  it('strips additionalProperties / $schema from tool parameters before sending', async () => {
    let capturedBody: any = null;
    vi.spyOn(global, 'fetch').mockImplementationOnce(async (_url, init) => {
      capturedBody = JSON.parse((init as any).body);
      return {
        ok: true,
        json: () => Promise.resolve({
          id: 'c', object: 'chat.completion', created: 1, model: 'command-a',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      } as any;
    });

    await provider.chatCompletion('k', [{ role: 'user', content: 'Hi' }], 'command-a-03-2025', {
      tools: [{
        type: 'function',
        function: {
          name: 'get_weather',
          parameters: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            additionalProperties: false,
            properties: {
              city: { type: 'string' },
              opts: { type: 'object', additionalProperties: false, properties: {} },
            },
          },
        },
      }],
    });

    const params = capturedBody.tools[0].function.parameters;
    expect(params.additionalProperties).toBeUndefined();
    expect(params.$schema).toBeUndefined();
    expect(params.properties.opts.additionalProperties).toBeUndefined();
    // Real schema content is preserved.
    expect(params.type).toBe('object');
    expect(params.properties.city).toEqual({ type: 'string' });
  });

  it('passes through requests with no tools unchanged', async () => {
    let capturedBody: any = null;
    vi.spyOn(global, 'fetch').mockImplementationOnce(async (_url, init) => {
      capturedBody = JSON.parse((init as any).body);
      return {
        ok: true,
        json: () => Promise.resolve({
          id: 'c', object: 'chat.completion', created: 1, model: 'command-a',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      } as any;
    });

    await provider.chatCompletion('k', [{ role: 'user', content: 'Hi' }], 'command-a-03-2025');
    expect(capturedBody.tools).toBeUndefined();
  });

  it('should validate key', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true } as any);
    expect(await provider.validateKey('valid')).toBe(true);
  });

  // Cohere's v2 error schema is a TOP-LEVEL `message`, not the OpenAI-style
  // `error.message`. Reading only the latter collapsed every rejection to
  // "Bad Request", which is what an agent sees when its tool schema is
  // refused — there was nothing to debug from.
  it('reports the real cause of a 400 instead of the bare status text', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: new Headers(),
      json: () => Promise.resolve({
        id: '9c1a4e2e-3f0b-4a6d-9c2e-1b7d5f8a0c31',
        message: 'invalid request: tools.0.function.parameters: $schema is not supported',
      }),
    } as any);

    const err = await provider
      .chatCompletion('k', [{ role: 'user', content: 'Hi' }], 'command-a-03-2025')
      .then(() => null, (e: any) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('$schema is not supported'); // the real cause
    expect(err.message).not.toContain('Bad Request'); // the old, useless text
    expect(err.status).toBe(400); // still classified as a provider bad request
  });

  it('still prefers the OpenAI-style error.message when a provider sends both', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: new Headers(),
      json: () => Promise.resolve({
        message: 'top level',
        error: { message: 'nested wins' },
      }),
    } as any);

    await expect(
      provider.chatCompletion('k', [{ role: 'user', content: 'Hi' }], 'command-a-03-2025'),
    ).rejects.toThrow(/nested wins/);
  });
});

describe('CohereProvider: tool-schema ladder (a refused schema is retried, not failed over)', () => {
  let provider: CohereProvider;

  const TOOLS = [{
    type: 'function' as const,
    function: {
      name: 'get_weather',
      parameters: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        title: 'Weather lookup',
        additionalProperties: false,
        required: ['city'],
        properties: { city: { type: 'string', pattern: '^.+$' } },
      },
    },
  }];

  const OK = {
    id: 'c', object: 'chat.completion', created: 1, model: 'command-a-03-2025',
    choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };

  const SSE =
    'data: {"id":"c","object":"chat.completion.chunk","created":1,"model":"m",' +
    '"choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\n' +
    'data: [DONE]\n\n';

  /** Serve `responses` in order (last one repeats). Returns bodies actually sent. */
  function queueFetch(...responses: Array<{ status: number; body?: any; sse?: string }>) {
    const sent: any[] = [];
    let i = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      sent.push(JSON.parse((init as any).body));
      const r = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return {
        ok: r.status < 400,
        status: r.status,
        statusText: r.status === 400 ? 'Bad Request' : 'OK',
        headers: new Headers(),
        json: () => Promise.resolve(r.body ?? {}),
        body: r.sse
          ? new ReadableStream({
              start(c) {
                c.enqueue(new TextEncoder().encode(r.sse as string));
                c.close();
              },
            })
          : null,
      } as any;
    });
    return sent;
  }

  const error400 = (message: string) => ({ status: 400, body: { message } });
  const call = (tools?: any) =>
    provider.chatCompletion('k', [{ role: 'user', content: 'Hi' }], 'command-a-03-2025', { tools });

  beforeEach(() => {
    provider = new CohereProvider();
    recordQuota.mockClear();
  });

  it('sends at L1 on the first attempt — the level Cohere opts into', async () => {
    const sent = queueFetch({ status: 200, body: OK });
    await call(TOOLS);

    const p = sent[0].tools[0].function.parameters;
    expect(p).not.toHaveProperty('$schema');
    expect(p).not.toHaveProperty('additionalProperties');
    expect(p).not.toHaveProperty('title');
    // A real constraint survives L1 — it is not a blanket flattening.
    expect(p.properties.city.pattern).toBe('^.+$');
  });

  it('a 400 retries once at L2 and succeeds instead of costing a failover hop', async () => {
    const sent = queueFetch(error400('invalid request: tools.0.function.parameters'), { status: 200, body: OK });

    const data = await call(TOOLS);

    expect(sent).toHaveLength(2); // exactly one retry
    expect(data.choices[0].message.content).toBe('ok');
    expect(sent[1].tools[0].function.parameters).toEqual({
      type: 'object',
      required: ['city'],
      properties: { city: { type: 'string' } }, // pattern dropped: that is L2's job
    });
  });

  it('does not retry when there were no tools — a 400 is then the real answer', async () => {
    const sent = queueFetch(error400('invalid request: messages'), { status: 200, body: OK });
    await expect(call()).rejects.toThrow(/400/);
    expect(sent).toHaveLength(1);
  });

  it('stops at L2 — a 400 there is not retried a third time', async () => {
    const sent = queueFetch(error400('nope at L1'), error400('nope at L2'), { status: 200, body: OK });
    await expect(call(TOOLS)).rejects.toThrow(/400/);
    expect(sent).toHaveLength(2);
  });

  it('never retries a context-too-large rejection — it must fail over to a bigger window', async () => {
    // Zhipu words this as a 400 (#873), so it clears isProviderBadRequestError
    // too. Retrying it would only add latency to the same conclusion.
    const sent = queueFetch(error400('prompt is too long: 300000 tokens > 200000 maximum'));
    await expect(call(TOOLS)).rejects.toThrow(/too long/);
    expect(sent).toHaveLength(1);
  });

  it('never retries anything that is not a bad request (a 429 must rotate keys)', async () => {
    const sent = queueFetch({ status: 429, body: { message: 'rate limit' } });
    await expect(call(TOOLS)).rejects.toThrow(/429/);
    expect(sent).toHaveLength(1);
  });

  it('retries the streaming path too, before any SSE byte exists', async () => {
    const sent = queueFetch(error400('bad schema'), { status: 200, sse: SSE });

    const chunks: any[] = [];
    for await (const c of provider.streamChatCompletion(
      'k', [{ role: 'user', content: 'Hi' }], 'command-a-03-2025', { tools: TOOLS },
    )) chunks.push(c);

    expect(sent).toHaveLength(2);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('TOOL_SCHEMA_LADDER=0 stops the retry without un-doing the sanitization', async () => {
    // The rollback path: turning the retry off must not revive the very
    // schema rejection it exists to work around.
    process.env.TOOL_SCHEMA_LADDER = '0';
    try {
      const sent = queueFetch(error400('bad schema'), { status: 200, body: OK });
      await expect(call(TOOLS)).rejects.toThrow(/400/);
      expect(sent).toHaveLength(1);
      expect(sent[0].tools[0].function.parameters).not.toHaveProperty('$schema');
    } finally {
      delete process.env.TOOL_SCHEMA_LADDER;
    }
  });

  it('records one quota observation per HTTP attempt — never a double count of usage', async () => {
    // Observations are ABSOLUTE header samples (remaining/limit), so an extra
    // one cannot inflate a total; usage tokens are recorded once, upstream,
    // from the single response handed back to the caller. The 400's headers are
    // still worth reading — that is the same signal a 429 gives.
    const sent = queueFetch(error400('bad schema'), { status: 200, body: OK });
    await call(TOOLS);

    expect(sent).toHaveLength(2);
    expect(recordQuota).toHaveBeenCalledTimes(2);
  });
});
