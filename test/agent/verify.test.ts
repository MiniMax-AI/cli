import { afterEach, describe, expect, it } from 'bun:test';

import { verifyAgentCredential } from '../../src/agent/verify';

describe('agent credential verification', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('does not echo an API key reflected by an upstream error', async () => {
    const apiKey = 'sensitive-test-value';
    globalThis.fetch = (async () => new Response(JSON.stringify({
      error: { message: `Rejected ${apiKey}` },
    }), { status: 401 })) as unknown as typeof fetch;

    let caught: unknown;
    try {
      await verifyAgentCredential({ apiKey, region: 'global', model: 'MiniMax-M3' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain(apiKey);
  });

  it('requests a stream so verification does not wait for full generation', async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response('data: {"type":"response.created","response":'
        + '{"id":"resp_test","model":"MiniMax-M3"}}\n\n');
    }) as unknown as typeof fetch;

    const result = await verifyAgentCredential({
      apiKey: 'sensitive-test-value',
      region: 'global',
      model: 'MiniMax-M3',
    });

    expect(requestBody?.stream).toBe(true);
    expect(result.status).toBe('ok');
  });

  it('rejects an HTTP success without a Responses API event', async () => {
    const mockFetch = async () => new Response('data: verification started\n\n');
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await expect(verifyAgentCredential({
      apiKey: 'sensitive-test-value',
      region: 'global',
      model: 'MiniMax-M3',
    })).rejects.toThrow('invalid agent verification response');
  });
});
