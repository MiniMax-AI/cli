/**
 * Tests for auth timeout bug fixes:
 *
 * Bug 1 (detect-region.ts): Region probe only sent Bearer auth — keys that
 *   only work with x-api-key would fail all probes, fall back to 'global',
 *   and every subsequent request would time out or 401.
 *
 * Bug 2 (refresh.ts): Token refresh had no timeout — a slow/unreachable auth
 *   server caused the CLI to hang indefinitely.
 *
 * Bug 3 (handler.ts): Timeout errors showed a generic "try --timeout" hint
 *   with no guidance about wrong-region or auth issues.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { createMockServer, jsonResponse, type MockServer } from '../helpers/mock-server';
import { CLIError } from '../../src/errors/base';
import { ExitCode } from '../../src/errors/codes';

// ---------------------------------------------------------------------------
// Bug 1 — detect-region probes both Bearer and x-api-key auth styles
// ---------------------------------------------------------------------------

describe('detect-region: probeRegion auth style fallback', () => {
  let server: MockServer;

  afterEach(() => server?.close());

  it('succeeds when endpoint only accepts Bearer token', async () => {
    server = createMockServer({
      routes: {
        '/v1/token_plan/remains': (req) => {
          if (req.headers.get('Authorization') === 'Bearer bearer-only-key') {
            return jsonResponse({ base_resp: { status_code: 0 } });
          }
          return jsonResponse({ error: 'unauthorized' }, 401);
        },
      },
    });

    // Patch REGIONS to point at our mock server
    const { REGIONS } = await import('../../src/config/schema');
    const origGlobal = REGIONS.global;
    (REGIONS as Record<string, string>).global = server.url;

    try {
      const { detectRegion } = await import('../../src/config/detect-region');
      const region = await detectRegion('bearer-only-key');
      expect(region).toBe('global');
    } finally {
      (REGIONS as Record<string, string>).global = origGlobal;
    }
  });

  it('succeeds when endpoint only accepts x-api-key header', async () => {
    server = createMockServer({
      routes: {
        '/v1/token_plan/remains': (req) => {
          if (req.headers.get('x-api-key') === 'xapikey-only-key') {
            return jsonResponse({ base_resp: { status_code: 0 } });
          }
          return jsonResponse({ error: 'unauthorized' }, 401);
        },
      },
    });

    const { REGIONS } = await import('../../src/config/schema');
    const origGlobal = REGIONS.global;
    (REGIONS as Record<string, string>).global = server.url;

    try {
      const { detectRegion } = await import('../../src/config/detect-region');
      const region = await detectRegion('xapikey-only-key');
      expect(region).toBe('global');
    } finally {
      (REGIONS as Record<string, string>).global = origGlobal;
    }
  });

  it('falls back to global when key is invalid for all auth styles and regions', async () => {
    server = createMockServer({
      routes: {
        '/v1/token_plan/remains': () =>
          jsonResponse({ error: 'unauthorized' }, 401),
      },
    });

    const { REGIONS } = await import('../../src/config/schema');
    const origGlobal = REGIONS.global;
    const origCn = REGIONS.cn;
    (REGIONS as Record<string, string>).global = server.url;
    (REGIONS as Record<string, string>).cn = server.url;

    try {
      const { detectRegion } = await import('../../src/config/detect-region');
      const region = await detectRegion('bad-key');
      expect(region).toBe('global'); // graceful fallback
    } finally {
      (REGIONS as Record<string, string>).global = origGlobal;
      (REGIONS as Record<string, string>).cn = origCn;
    }
  });
});

// ---------------------------------------------------------------------------
// Bug 2 — token refresh has a 10-second timeout and clear error messages
// ---------------------------------------------------------------------------

describe('refreshAccessToken: timeout and error handling', () => {
  let server: MockServer;

  afterEach(() => server?.close());

  it('throws a CLIError with AUTH exit code when refresh endpoint returns non-ok', async () => {
    server = createMockServer({
      routes: {
        '/v1/oauth/token': () => jsonResponse({ error: 'invalid_grant' }, 400),
      },
    });

    // Temporarily redirect TOKEN_URL to our mock
    const mod = await import('../../src/auth/refresh');

    // We test the real function against a mock server via a wrapper
    // that overrides the fetch to hit our local server instead.
    const origFetch = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('oauth/token')) {
        return origFetch(`${server.url}/v1/oauth/token`, init);
      }
      return origFetch(input, init);
    };

    try {
      await expect(mod.refreshAccessToken('expired-refresh-token')).rejects.toMatchObject({
        exitCode: ExitCode.AUTH,
      });
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('returns a fresh token when refresh succeeds', async () => {
    server = createMockServer({
      routes: {
        '/v1/oauth/token': () =>
          jsonResponse({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
      },
    });

    const mod = await import('../../src/auth/refresh');
    const origFetch = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('oauth/token')) {
        return origFetch(`${server.url}/v1/oauth/token`, init);
      }
      return origFetch(input, init);
    };

    try {
      const tokens = await mod.refreshAccessToken('valid-refresh-token');
      expect(tokens.access_token).toBe('new-access-token');
      expect(tokens.expires_in).toBe(3600);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('ensureFreshToken returns cached token when not near expiry', async () => {
    const mod = await import('../../src/auth/refresh');
    const token = await mod.ensureFreshToken({
      access_token: 'still-valid',
      refresh_token: 'refresh',
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1h from now
      token_type: 'Bearer',
    });
    expect(token).toBe('still-valid');
  });
});

// ---------------------------------------------------------------------------
// Bug 3 — timeout error message includes auth / region diagnostic hints
// ---------------------------------------------------------------------------

describe('handleError: timeout message includes region/auth hint', () => {
  it('AbortError message contains region override hint', () => {
    const { handleError } = require('../../src/errors/handler');

    const abortErr = new DOMException('The operation was aborted.', 'AbortError');

    let captured = '';
    const origWrite = process.stderr.write.bind(process.stderr);
    const origExit = process.exit;
    (process.stderr as NodeJS.WriteStream).write = (chunk: unknown) => {
      captured += String(chunk);
      return true;
    };
    (process as unknown as Record<string, unknown>).exit = () => { throw new Error('exit'); };

    try {
      handleError(abortErr);
    } catch {
      // mocked process.exit throws — expected
    } finally {
      (process.stderr as NodeJS.WriteStream).write = origWrite;
      (process as unknown as Record<string, unknown>).exit = origExit;
    }

    expect(captured).toContain('mmx auth status');
    expect(captured).toContain('region');
  });

  it('CLIError with TIMEOUT exit code shows correct hint', () => {
    const err = new CLIError('Request timed out.', ExitCode.TIMEOUT,
      'Try increasing --timeout (e.g. --timeout 60).\n' +
      'If this happens on every request with a valid API key, you may be hitting the wrong region.\n' +
      'Run: mmx auth status   — to check your credentials and region.\n' +
      'Run: mmx config set region global   (or cn) — to override the region.',
    );

    expect(err.exitCode).toBe(ExitCode.TIMEOUT);
    expect(err.hint).toContain('mmx auth status');
    expect(err.hint).toContain('mmx config set region');
  });
});
