import { describe, it, expect, afterEach } from 'bun:test';
import { requestJson, retryDelayMs } from '../../src/client/http';
import { CLI_VERSION } from '../../src/version';
import { createMockServer, jsonResponse, type MockServer } from '../helpers/mock-server';
import type { Config } from '../../src/config/schema';

function makeConfig(baseUrl: string): Config {
  return {
    apiKey: 'test-api-key',
    region: 'global',
    baseUrl,
    output: 'text',
    timeout: 10,
    verbose: false,
    quiet: false,
    noColor: false,
    yes: false,
    dryRun: false,
    nonInteractive: false,
    async: false,
  };
}

describe('HTTP client', () => {
  let server: MockServer;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    server?.close();
    globalThis.fetch = originalFetch;
  });

  it('makes authenticated GET request', async () => {
    let userAgent: string | null = null;
    server = createMockServer({
      routes: {
        '/v1/test': (req) => {
          userAgent = req.headers.get('user-agent');
          return jsonResponse({ result: 'ok' });
        },
      },
    });

    const config = makeConfig(server.url);
    const result = await requestJson<{ result: string }>(config, {
      url: `${server.url}/v1/test`,
    });

    expect(result.result).toBe('ok');
    expect(userAgent ?? '').toBe(`mmx-cli/${CLI_VERSION}`);
  });

  it('makes POST request with body', async () => {
    server = createMockServer({
      routes: {
        '/v1/test': async (req) => {
          const body = await req.json();
          return jsonResponse({ echo: body });
        },
      },
    });

    const config = makeConfig(server.url);
    const result = await requestJson<{ echo: unknown }>(config, {
      url: `${server.url}/v1/test`,
      method: 'POST',
      body: { hello: 'world' },
    });

    expect(result.echo).toEqual({ hello: 'world' });
  });

  it('throws CLIError on 401', async () => {
    server = createMockServer({
      routes: {
        '/v1/test': () => jsonResponse({ error: 'unauthorized' }, 401),
      },
    });

    const config = makeConfig(server.url);
    await expect(
      requestJson(config, { url: `${server.url}/v1/test` }),
    ).rejects.toThrow('API key rejected');
  });

  it('throws CLIError on 429', async () => {
    server = createMockServer({
      routes: {
        '/v1/test': () => jsonResponse({ base_resp: { status_code: 0, status_msg: 'too many' } }, 429),
      },
    });

    const config = makeConfig(server.url);
    await expect(
      requestJson(config, { url: `${server.url}/v1/test` }),
    ).rejects.toThrow('Rate limit');
  });

  it.each([408, 429, 500, 502, 503, 504])('retries HTTP %d and then succeeds', async (status) => {
    let attempts = 0;
    server = createMockServer({
      routes: {
        '/v1/test': () => {
          attempts++;
          if (attempts < 3) {
            return new Response('transient', {
              status,
              headers: { 'Retry-After': '0' },
            });
          }
          return jsonResponse({ result: 'ok' });
        },
      },
    });

    const result = await requestJson<{ result: string }>(makeConfig(server.url), {
      url: `${server.url}/v1/test`,
    });

    expect(result.result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('stops after the bounded number of attempts', async () => {
    let attempts = 0;
    server = createMockServer({
      routes: {
        '/v1/test': () => {
          attempts++;
          return new Response('unavailable', {
            status: 503,
            headers: { 'Retry-After': '0' },
          });
        },
      },
    });

    await expect(
      requestJson(makeConfig(server.url), { url: `${server.url}/v1/test` }),
    ).rejects.toThrow('HTTP 503');
    expect(attempts).toBe(3);
  });

  it.each([400, 401, 403, 404, 409, 422])('does not retry permanent HTTP %d errors', async (status) => {
    let attempts = 0;
    server = createMockServer({
      routes: {
        '/v1/test': () => {
          attempts++;
          return jsonResponse({ error: { message: 'permanent' } }, status);
        },
      },
    });

    await expect(
      requestJson(makeConfig(server.url), { url: `${server.url}/v1/test` }),
    ).rejects.toBeInstanceOf(Error);
    expect(attempts).toBe(1);
  });

  it('retries transient network failures', async () => {
    let attempts = 0;
    globalThis.fetch = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        attempts++;
        if (attempts === 1) throw new TypeError('connection reset');
        return originalFetch(...args);
      },
      { preconnect: originalFetch.preconnect },
    );
    server = createMockServer({
      routes: { '/v1/test': () => jsonResponse({ result: 'ok' }) },
    });

    const result = await requestJson<{ result: string }>(makeConfig(server.url), {
      url: `${server.url}/v1/test`,
    });

    expect(result.result).toBe('ok');
    expect(attempts).toBe(2);
  });

  it('retries per-attempt timeout failures', async () => {
    let attempts = 0;
    globalThis.fetch = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        attempts++;
        if (attempts === 1) throw new DOMException('timed out', 'TimeoutError');
        return originalFetch(...args);
      },
      { preconnect: originalFetch.preconnect },
    );
    server = createMockServer({
      routes: { '/v1/test': () => jsonResponse({ result: 'ok' }) },
    });

    const result = await requestJson<{ result: string }>(makeConfig(server.url), {
      url: `${server.url}/v1/test`,
    });

    expect(result.result).toBe('ok');
    expect(attempts).toBe(2);
  });

  it('replays JSON request bodies on retry', async () => {
    const bodies: unknown[] = [];
    server = createMockServer({
      routes: {
        '/v1/test': async (req) => {
          bodies.push(await req.json());
          if (bodies.length === 1) {
            return new Response('unavailable', {
              status: 503,
              headers: { 'Retry-After': '0' },
            });
          }
          return jsonResponse({ result: 'ok' });
        },
      },
    });

    await requestJson(makeConfig(server.url), {
      url: `${server.url}/v1/test`,
      method: 'POST',
      body: { hello: 'world' },
    });

    expect(bodies).toEqual([{ hello: 'world' }, { hello: 'world' }]);
  });

  it('replays FormData request bodies on retry', async () => {
    const values: string[] = [];
    server = createMockServer({
      routes: {
        '/v1/test': async (req) => {
          const form = await req.formData();
          values.push(String(form.get('purpose')));
          if (values.length === 1) {
            return new Response('unavailable', {
              status: 503,
              headers: { 'Retry-After': '0' },
            });
          }
          return jsonResponse({ result: 'ok' });
        },
      },
    });
    const body = new FormData();
    body.append('purpose', 'retrieval');

    await requestJson(makeConfig(server.url), {
      url: `${server.url}/v1/test`,
      method: 'POST',
      body,
    });

    expect(values).toEqual(['retrieval', 'retrieval']);
  });
});

describe('retryDelayMs', () => {
  it('uses deterministic exponential backoff with injected jitter', () => {
    expect(retryDelayMs(1, null, 0, 1)).toBe(250);
    expect(retryDelayMs(2, null, 0, 0.5)).toBe(250);
  });

  it('supports Retry-After seconds and HTTP dates', () => {
    const now = Date.parse('2026-08-05T00:00:00Z');
    expect(retryDelayMs(1, '2', now, 0)).toBe(2_000);
    expect(retryDelayMs(1, 'Wed, 05 Aug 2026 00:00:03 GMT', now, 0)).toBe(3_000);
  });

  it('caps Retry-After and falls back for invalid values', () => {
    expect(retryDelayMs(1, '120', 0, 0)).toBe(30_000);
    expect(retryDelayMs(1, 'invalid', 0, 1)).toBe(250);
  });
});
