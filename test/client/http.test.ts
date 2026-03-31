import { describe, it, expect, afterEach } from 'bun:test';
import { requestJson, resetStatusBar } from '../../src/client/http';
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
    quiet: true,
    noColor: true,
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
    resetStatusBar();
  });

  it('makes authenticated GET request', async () => {
    server = createMockServer({
      routes: {
        '/v1/test': () => jsonResponse({ result: 'ok' }),
      },
    });

    const config = makeConfig(server.url);
    const result = await requestJson<{ result: string }>(config, {
      url: `${server.url}/v1/test`,
    });

    expect(result.result).toBe('ok');
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
});
