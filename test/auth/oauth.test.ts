import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';

// Prevent openBrowser from actually opening a browser during tests
mock.module('child_process', () => ({
  execFile: () => {},
  spawn: () => {},
}));

// Dynamic import to avoid module-level side effects
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let deviceCodeLogin: any;

beforeEach(async () => {
  const mod = await import('../../src/auth/oauth');
  deviceCodeLogin = mod.deviceCodeLogin;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let capturedState: string | null = null;
let capturedCodeVerifier: string | null = null;

/**
 * Build a device/code response whose `state` echoes back the value
 * extracted from the actual request body — so it always matches.
 */
function deviceCodeResponse(reqBody: URLSearchParams, overrides: Record<string, unknown> = {}): Response {
  capturedState = reqBody.get('state');
  capturedCodeVerifier = reqBody.get('code_verifier') ?? reqBody.get('code_challenge');
  return {
    status: 200,
    ok: true,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => ({
      user_code: 'TEST-CODE',
      verification_uri: 'about:blank',
      expired_in: Date.now() + 120_000,
      interval: 10,
      state: capturedState,
      ...overrides,
    }),
  } as Response;
}

function tokenResponse(overrides: Record<string, unknown> = {}) {
  return {
    status: 200,
    ok: true,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => ({
      status: 'success',
      access_token: 'at-abcdef',
      refresh_token: 'rt-abcdef',
      expired_in: Date.now() + 86_400_000,
      ...overrides,
    }),
  } as Response;
}

function errorResponse(status: number, body?: string) {
  return {
    status,
    ok: false,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    text: async () => body || '{}',
    json: async () => JSON.parse(body || '{}'),
  } as Response;
}

const originalFetch = globalThis.fetch;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setFetch(fn: any): void {
  globalThis.fetch = fn as typeof globalThis.fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  capturedState = null;
  capturedCodeVerifier = null;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deviceCodeLogin', () => {
  it('completes successfully when user approves promptly', async () => {
    let pollCount = 0;
    setFetch(mock((url: string, opts?: RequestInit) => {
      if (url.includes('device/code')) {
        const body = opts?.body instanceof URLSearchParams
          ? opts.body : new URLSearchParams(String(opts?.body ?? ''));
        return Promise.resolve(deviceCodeResponse(body));
      }
      pollCount++;
      return Promise.resolve(tokenResponse());
    }));

    const result = await deviceCodeLogin('global');

    expect(result.access_token).toBe('at-abcdef');
    expect(result.refresh_token).toBe('rt-abcdef');
    expect(typeof result.expires_at).toBe('string');
    expect(result.region).toBe('global');
    expect(pollCount).toBeGreaterThanOrEqual(1);
  });

  it('returns resource_url when provided by the server', async () => {
    setFetch(mock((url: string, opts?: RequestInit) => {
      if (url.includes('device/code')) {
        const body = opts?.body instanceof URLSearchParams
          ? opts.body : new URLSearchParams(String(opts?.body ?? ''));
        return Promise.resolve(deviceCodeResponse(body));
      }
      return Promise.resolve(tokenResponse({ resource_url: 'https://custom.api.com' }));
    }));

    const result = await deviceCodeLogin('cn');

    expect(result.resource_url).toBe('https://custom.api.com');
    expect(result.region).toBe('cn');
  });

  it('throws when device-code request fails with HTTP error', async () => {
    setFetch(mock(() => Promise.resolve(errorResponse(500, 'Server Error'))));

    await expect(deviceCodeLogin('global')).rejects.toThrow('Failed to start device-code flow');
  });

  it('throws on state mismatch', async () => {
    // Return a state that's guaranteed to differ from the generated one.
    // The generated state is ~22 chars of base64url; this one clearly differs.
    setFetch(mock((url: string, opts?: RequestInit) => {
      if (url.includes('device/code')) {
        const body = opts?.body instanceof URLSearchParams
          ? opts.body : new URLSearchParams(String(opts?.body ?? ''));
        return Promise.resolve(deviceCodeResponse(body, { state: 'tampered-state' }));
      }
      return Promise.resolve(tokenResponse());
    }));

    await expect(deviceCodeLogin('global')).rejects.toThrow('state mismatch');
  });

  it('polls until success when token returns pending first', async () => {
    let pollCount = 0;
    setFetch(mock((url: string, opts?: RequestInit) => {
      if (url.includes('device/code')) {
        const body = opts?.body instanceof URLSearchParams
          ? opts.body : new URLSearchParams(String(opts?.body ?? ''));
        return Promise.resolve(deviceCodeResponse(body, { interval: 1 }));
      }
      pollCount++;
      if (pollCount <= 2) return Promise.resolve(tokenResponse({ status: 'pending' }));
      return Promise.resolve(tokenResponse());
    }));

    const result = await deviceCodeLogin('global');

    expect(result.access_token).toBe('at-abcdef');
    expect(pollCount).toBe(3); // 2 pending + 1 success
  });

  it('throws when token endpoint returns a failed status', async () => {
    setFetch(mock((url: string, opts?: RequestInit) => {
      if (url.includes('device/code')) {
        const body = opts?.body instanceof URLSearchParams
          ? opts.body : new URLSearchParams(String(opts?.body ?? ''));
        return Promise.resolve(deviceCodeResponse(body, { interval: 1 }));
      }
      return Promise.resolve(tokenResponse({ status: 'rejected' }));
    }));

    await expect(deviceCodeLogin('global')).rejects.toThrow('authorization failed: rejected');
  });

  it('throws when token endpoint returns HTTP error', async () => {
    setFetch(mock((url: string, opts?: RequestInit) => {
      if (url.includes('device/code')) {
        const body = opts?.body instanceof URLSearchParams
          ? opts.body : new URLSearchParams(String(opts?.body ?? ''));
        return Promise.resolve(deviceCodeResponse(body, { interval: 1 }));
      }
      return Promise.resolve(errorResponse(403));
    }));

    await expect(deviceCodeLogin('global')).rejects.toThrow('authorization failed (HTTP 403)');
  });

  it('throws on timeout when user never approves', async () => {
    setFetch(mock((url: string, opts?: RequestInit) => {
      if (url.includes('device/code')) {
        const body = opts?.body instanceof URLSearchParams
          ? opts.body : new URLSearchParams(String(opts?.body ?? ''));
        // expired_in just barely in future → loop exits quickly
        return Promise.resolve(deviceCodeResponse(body, { expired_in: Date.now() + 10, interval: 1 }));
      }
      return Promise.resolve(tokenResponse({ status: 'pending' }));
    }));

    await expect(deviceCodeLogin('global')).rejects.toThrow('authorization timed out');
  });

  it('uses correct OAuth host for global region', async () => {
    let deviceCodeUrl = '';
    setFetch(mock((url: string, opts?: RequestInit) => {
      if (url.includes('device/code')) {
        deviceCodeUrl = url;
        const body = opts?.body instanceof URLSearchParams
          ? opts.body : new URLSearchParams(String(opts?.body ?? ''));
        return Promise.resolve(deviceCodeResponse(body));
      }
      return Promise.resolve(tokenResponse());
    }));

    await deviceCodeLogin('global');
    expect(deviceCodeUrl).toContain('account.minimax.io');
    expect(deviceCodeUrl).toContain('/oauth2/device/code');
  });

  it('uses correct OAuth host for cn region', async () => {
    let deviceCodeUrl = '';
    setFetch(mock((url: string, opts?: RequestInit) => {
      if (url.includes('device/code')) {
        deviceCodeUrl = url;
        const body = opts?.body instanceof URLSearchParams
          ? opts.body : new URLSearchParams(String(opts?.body ?? ''));
        return Promise.resolve(deviceCodeResponse(body));
      }
      return Promise.resolve(tokenResponse());
    }));

    await deviceCodeLogin('cn');
    expect(deviceCodeUrl).toContain('account.minimaxi.com');
    expect(deviceCodeUrl).toContain('/oauth2/device/code');
  });

  it('sends PKCE parameters in device-code request', async () => {
    setFetch(mock((url: string, opts?: RequestInit) => {
      if (url.includes('device/code')) {
        const body = opts?.body instanceof URLSearchParams
          ? opts.body : new URLSearchParams(String(opts?.body ?? ''));
        return Promise.resolve(deviceCodeResponse(body));
      }
      return Promise.resolve(tokenResponse());
    }));

    await deviceCodeLogin('global');

    expect(capturedState).toBeDefined();
    expect(capturedState!.length).toBeGreaterThan(0);
    expect(capturedCodeVerifier).toBeDefined();
    expect(capturedCodeVerifier!.length).toBeGreaterThan(0);
  });
});
