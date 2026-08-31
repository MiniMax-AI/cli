import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { verifyAgentCredential } from '../../src/agent/verify';
import { CLIError } from '../../src/errors/base';
import { ExitCode } from '../../src/errors/codes';

const PROXY_ENV_KEYS = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
] as const;

function fetchFailure(code: string, message: string): Error {
  const error = new TypeError('fetch failed') as TypeError & { cause?: unknown };
  error.cause = Object.assign(new Error(message), { code });
  return error;
}

async function captureVerificationError(overrides: {
  proxy?: string;
  region?: 'cn' | 'global';
  timeoutSeconds?: number;
} = {}): Promise<CLIError> {
  try {
    await verifyAgentCredential({
      apiKey: 'sensitive-test-value',
      region: overrides.region ?? 'global',
      model: 'MiniMax-M3',
      timeoutSeconds: overrides.timeoutSeconds,
      proxy: overrides.proxy,
    });
  } catch (error) {
    expect(error).toBeInstanceOf(CLIError);
    return error as CLIError;
  }
  throw new Error('Expected verification to fail.');
}

describe('agent credential verification', () => {
  const originalFetch = globalThis.fetch;
  const originalProxyEnvironment = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of PROXY_ENV_KEYS) {
      originalProxyEnvironment.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const key of PROXY_ENV_KEYS) {
      const value = originalProxyEnvironment.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    originalProxyEnvironment.clear();
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

  it('passes a configured proxy to Bun fetch', async () => {
    let proxy: string | undefined;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      proxy = (init as RequestInit & { proxy?: string }).proxy;
      return new Response('data: {"type":"response.created","response":'
        + '{"id":"resp_test","model":"MiniMax-M3"}}\n\n');
    }) as unknown as typeof fetch;

    await verifyAgentCredential({
      apiKey: 'sensitive-test-value',
      region: 'global',
      model: 'MiniMax-M3',
      proxy: 'http://proxy.example:8080',
    });

    expect(proxy).toBe('http://proxy.example:8080');
  });

  it('keeps environment proxy precedence over a configured proxy', async () => {
    let proxy: string | undefined;
    process.env.HTTPS_PROXY = 'http://environment-proxy.example:8080';
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      proxy = (init as RequestInit & { proxy?: string }).proxy;
      return new Response('data: {"type":"response.created","response":'
        + '{"id":"resp_test","model":"MiniMax-M3"}}\n\n');
    }) as unknown as typeof fetch;

    await verifyAgentCredential({
      apiKey: 'sensitive-test-value',
      region: 'global',
      model: 'MiniMax-M3',
      proxy: 'http://config-proxy.example:8080',
    });

    expect(proxy).toBe('http://environment-proxy.example:8080');
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

  it('explains DNS failures without exposing the generic fetch message', async () => {
    globalThis.fetch = (async () => {
      throw fetchFailure('EAI_AGAIN', 'getaddrinfo EAI_AGAIN api.minimaxi.com');
    }) as unknown as typeof fetch;

    const caught = await captureVerificationError({ region: 'cn' });

    expect(caught.message).toBe('Could not resolve api.minimaxi.com.');
    expect(caught.message).not.toContain('fetch failed');
    expect(caught.exitCode).toBe(ExitCode.NETWORK);
    expect(caught.hint).toContain('Check DNS and internet access');
    expect(caught.hint).toContain('Technical detail: EAI_AGAIN.');
  });

  it('explains connection timeouts and uses the timeout exit code', async () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    globalThis.fetch = (async () => {
      throw timeout;
    }) as unknown as typeof fetch;

    const caught = await captureVerificationError({ timeoutSeconds: 12 });

    expect(caught.message).toBe(
      'Connection to api.minimax.io timed out after 12 seconds.',
    );
    expect(caught.exitCode).toBe(ExitCode.TIMEOUT);
    expect(caught.hint).toContain('selected MiniMax region');
  });

  it('preserves timeout guidance when an aborted response stream fails', async () => {
    const timeout = new Error('The operation was aborted');
    timeout.name = 'AbortError';
    globalThis.fetch = (async () => new Response(new ReadableStream({
      start(controller) {
        controller.error(timeout);
      },
    }))) as unknown as typeof fetch;

    const caught = await captureVerificationError({ timeoutSeconds: 8 });

    expect(caught.message).toBe(
      'Connection to api.minimax.io timed out after 8 seconds.',
    );
    expect(caught.exitCode).toBe(ExitCode.TIMEOUT);
  });

  it('uses response-reading guidance for other stream failures', async () => {
    globalThis.fetch = (async () => new Response(new ReadableStream({
      start(controller) {
        controller.error(fetchFailure('ECONNRESET', 'connection reset'));
      },
    }))) as unknown as typeof fetch;

    const caught = await captureVerificationError();

    expect(caught.message).toContain('interrupted while reading the verification response');
    expect(caught.message).not.toContain('Could not reach');
    expect(caught.exitCode).toBe(ExitCode.NETWORK);
  });

  it('maps HTTP timeout responses to timeout guidance', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 504 })) as unknown as typeof fetch;

    const caught = await captureVerificationError();

    expect(caught.message).toBe('MiniMax verification timed out (HTTP 504).');
    expect(caught.exitCode).toBe(ExitCode.TIMEOUT);
    expect(caught.hint).toContain('Check your connection and try again');
  });

  it('tells the user to retry a temporary MiniMax service failure', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 503 })) as unknown as typeof fetch;

    const caught = await captureVerificationError();

    expect(caught.message).toBe('MiniMax is temporarily unavailable (HTTP 503).');
    expect(caught.hint).toContain('Try again later');
  });

  it('maps HTTP 402 to quota guidance', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 402 })) as unknown as typeof fetch;

    const caught = await captureVerificationError();

    expect(caught.message).toContain('quota or balance is insufficient');
    expect(caught.exitCode).toBe(ExitCode.QUOTA);
  });

  it('explains refused connections and points to network controls', async () => {
    globalThis.fetch = (async () => {
      throw fetchFailure('ECONNREFUSED', 'connect ECONNREFUSED');
    }) as unknown as typeof fetch;

    const caught = await captureVerificationError();

    expect(caught.message).toBe('Could not connect to api.minimax.io.');
    expect(caught.hint).toContain('internet connection, firewall');
    expect(caught.hint).toContain('set HTTPS_PROXY');
  });

  it('explains connection failures through a configured proxy', async () => {
    globalThis.fetch = (async () => {
      throw fetchFailure('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:10801');
    }) as unknown as typeof fetch;

    const caught = await captureVerificationError({
      proxy: 'http://127.0.0.1:10801',
    });

    expect(caught.message).toContain('through the configured proxy');
    expect(caught.hint).toContain('Check the proxy address');
    expect(caught.hint).toContain('current shell or container');
  });
});
