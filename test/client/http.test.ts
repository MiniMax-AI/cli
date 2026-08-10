import { describe, it, expect, afterEach, spyOn } from 'bun:test';
import { request, requestJson } from '../../src/client/http';
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

  afterEach(() => {
    server?.close();
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

  it('aborts a streaming request when response headers stall', async () => {
    let aborted = false;
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(init.signal?.reason);
          }, { once: true });
        })
    ) as unknown as typeof fetch);

    try {
      const config = makeConfig('https://example.com');
      await expect(request(config, {
        url: 'https://example.com/stream',
        stream: true,
        timeout: 0.02,
        noAuth: true,
      })).rejects.toMatchObject({ name: 'TimeoutError' });
      expect(aborted).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('aborts and cancels a streaming response when its body stalls', async () => {
    let aborted = false;
    let cancelled = false;
    const encoder = new TextEncoder();
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((
      (_input: string | URL | Request, init?: RequestInit) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
        }, { once: true });

        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('data: first\n\n'));
          },
          cancel() {
            cancelled = true;
          },
        });
        return Promise.resolve(new Response(body));
      }
    ) as unknown as typeof fetch);

    try {
      const config = makeConfig('https://example.com');
      const response = await request(config, {
        url: 'https://example.com/stream',
        stream: true,
        timeout: 0.02,
        noAuth: true,
      });
      const reader = response.body!.getReader();

      expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: first\n\n');
      await expect(reader.read()).rejects.toMatchObject({ name: 'TimeoutError' });
      expect(aborted).toBe(true);
      expect(cancelled).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('allows an active stream to outlive a single timeout interval', async () => {
    let aborted = false;
    const encoder = new TextEncoder();
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((
      (_input: string | URL | Request, init?: RequestInit) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
        }, { once: true });

        let interval: ReturnType<typeof setInterval> | undefined;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            let chunk = 0;
            interval = setInterval(() => {
              controller.enqueue(encoder.encode(String(chunk)));
              chunk += 1;
              if (chunk === 6) {
                clearInterval(interval);
                controller.close();
              }
            }, 10);
          },
          cancel() {
            if (interval) clearInterval(interval);
          },
        });
        return Promise.resolve(new Response(body));
      }
    ) as unknown as typeof fetch);

    try {
      const config = makeConfig('https://example.com');
      const response = await request(config, {
        url: 'https://example.com/stream',
        stream: true,
        timeout: 0.03,
        noAuth: true,
      });
      const chunks: string[] = [];

      for await (const chunk of response.body!) {
        chunks.push(new TextDecoder().decode(chunk));
      }

      expect(chunks).toEqual(['0', '1', '2', '3', '4', '5']);
      expect(aborted).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('cancels the network request when the response consumer cancels', async () => {
    let aborted = false;
    let cancelled = false;
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((
      (_input: string | URL | Request, init?: RequestInit) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
        }, { once: true });

        const body = new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
        });
        return Promise.resolve(new Response(body));
      }
    ) as unknown as typeof fetch);

    try {
      const config = makeConfig('https://example.com');
      const response = await request(config, {
        url: 'https://example.com/stream',
        stream: true,
        timeout: 1,
        noAuth: true,
      });

      await response.body!.cancel('consumer stopped');

      expect(aborted).toBe(true);
      expect(cancelled).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
