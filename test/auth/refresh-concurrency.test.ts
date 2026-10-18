import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { loadCredentials, saveCredentials } from '../../src/auth/credentials';
import { ensureFreshToken } from '../../src/auth/refresh';
import type { CredentialFile } from '../../src/auth/types';
import { readConfigFile, writeConfigFile } from '../../src/config/loader';
import { OAUTH_HOSTS } from '../../src/config/schema';
import { ExitCode } from '../../src/errors/codes';
import { MiniMaxSDK } from '../../src/sdk';
import { createMockServer, jsonResponse, type MockServer } from '../helpers/mock-server';

describe('concurrent automatic OAuth refresh', () => {
  let directory: string;
  let originalConfigDir: string | undefined;
  let originalFetch: typeof fetch;
  let server: MockServer;
  let creds: CredentialFile;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'mmx-refresh-concurrency-'));
    originalConfigDir = process.env.MMX_CONFIG_DIR;
    process.env.MMX_CONFIG_DIR = directory;
    originalFetch = globalThis.fetch;
    creds = {
      access_token: 'expired-access',
      refresh_token: 'single-use-refresh',
      expires_at: new Date(Date.now() - 1000).toISOString(),
      region: 'global',
      account: 'fixture-account',
    };
    // Only the fixed OAuth host is redirected; SDK API requests use loopback.
    globalThis.fetch = ((input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (Object.values<string>(OAUTH_HOSTS).includes(url.origin)
          && url.pathname === '/oauth2/token') {
        return originalFetch(`${server.url}/oauth2/token`, init);
      }
      if (url.origin === server.url) return originalFetch(input, init);
      throw new Error(`Unexpected fixture request: ${url.origin}${url.pathname}`);
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    server?.close();
    if (originalConfigDir === undefined) delete process.env.MMX_CONFIG_DIR;
    else process.env.MMX_CONFIG_DIR = originalConfigDir;
    rmSync(directory, { recursive: true, force: true });
  });

  it('shares one rotating refresh and persists it before concurrent SDK requests continue', async () => {
    let refreshes = 0;
    const apiTokens: string[] = [];
    server = createMockServer({
      routes: {
        '/oauth2/token': async req => {
          const form = new URLSearchParams(await req.text());
          expect(form.get('refresh_token')).toBe(creds.refresh_token);
          refreshes++;
          if (refreshes > 1) return jsonResponse({ error: 'invalid_grant' }, 400);
          return jsonResponse({
            status: 'success', access_token: 'fresh-access', refresh_token: 'rotated-refresh',
            expired_in: Date.now() + 3600000, resource_url: server.url,
          });
        },
        '/v1/': async req => {
          apiTokens.push(req.headers.get('Authorization') ?? '');
          // Every waiter must resume only after the rotated credentials are saved.
          expect((await loadCredentials())?.refresh_token).toBe('rotated-refresh');
          return jsonResponse({ base_resp: { status_code: 0 }, system_voice: [], data: { image_urls: [] } });
        },
      },
    });
    await writeConfigFile({ oauth: creds, default_text_model: 'preserved-model' });
    const first = new MiniMaxSDK({ region: 'global', baseUrl: server.url });
    const second = new MiniMaxSDK({ region: 'global', baseUrl: server.url });
    const results = await Promise.allSettled([
      first.speech.voices(), first.image.generate({ prompt: 'Fixture' }),
      second.speech.voices(), second.image.generate({ prompt: 'Fixture' }),
    ]);
    expect(results.map(result => result.status)).toEqual(Array(4).fill('fulfilled'));
    expect(refreshes).toBe(1);
    expect(apiTokens).toEqual(Array(4).fill('Bearer fresh-access'));
    expect(await loadCredentials()).toMatchObject({
      access_token: 'fresh-access', refresh_token: 'rotated-refresh',
      account: creds.account, region: 'global', resource_url: server.url,
    });
    expect(readConfigFile().default_text_model).toBe('preserved-model');
    await first.speech.voices();
    expect(refreshes).toBe(1);
  });

  it('shares a failed refresh without changing credentials and allows a later attempt', async () => {
    let refreshes = 0;
    let fail = true;
    server = createMockServer({
      routes: {
        '/oauth2/token': () => {
          refreshes++;
          return fail ? jsonResponse({ error: 'invalid_grant' }, 400) : jsonResponse({
            status: 'success', access_token: 'recovered-access', expired_in: Date.now() + 3600000,
          });
        },
      },
    });
    await saveCredentials(creds);
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => ensureFreshToken({ ...creds })));
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    for (const result of results) {
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ exitCode: ExitCode.AUTH });
    }
    expect(refreshes).toBe(1);
    expect(await loadCredentials()).toEqual(creds);
    fail = false;
    expect(await ensureFreshToken(creds)).toBe('recovered-access');
    expect(refreshes).toBe(2);
    // A completed refresh must not become a permanent cached result.
    expect(await ensureFreshToken(creds)).toBe('recovered-access');
    expect(refreshes).toBe(3);
  });

  it.each(['region', 'refresh_token'] as const)('does not share refreshes with a different %s', async field => {
    let refreshes = 0;
    server = createMockServer({
      routes: { '/oauth2/token': () => {
        refreshes++;
        return jsonResponse({ error: 'invalid_grant' }, 400);
      } },
    });
    const other = { ...creds, [field]: field === 'region' ? 'cn' as const : 'different-refresh' };
    const results = await Promise.allSettled([ensureFreshToken(creds), ensureFreshToken(other)]);
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    expect(refreshes).toBe(2);
  });

  it('shares refreshes when absolute and relative paths select the same store', async () => {
    let refreshes = 0;
    server = createMockServer({
      routes: { '/oauth2/token': () => {
        refreshes++;
        return refreshes > 1 ? jsonResponse({ error: 'invalid_grant' }, 400) : jsonResponse({
          status: 'success', access_token: 'fresh-access', expired_in: Date.now() + 3600000,
        });
      } },
    });
    await saveCredentials(creds);
    const first = ensureFreshToken(creds);
    process.env.MMX_CONFIG_DIR = relative(process.cwd(), directory);
    const second = ensureFreshToken(creds);
    expect(await Promise.all([first, second])).toEqual(['fresh-access', 'fresh-access']);
    expect(refreshes).toBe(1);
    expect((await loadCredentials())?.access_token).toBe('fresh-access');
  });

  it('does not share refreshes between different credential stores', async () => {
    let refreshes = 0;
    server = createMockServer({
      routes: { '/oauth2/token': () => {
        refreshes++;
        return jsonResponse({
          status: 'success', access_token: `access-${refreshes}`, refresh_token: `refresh-${refreshes}`,
          expired_in: Date.now() + 3600000,
        });
      } },
    });
    const otherDirectory = join(directory, 'other-store');
    const otherCreds = { ...creds, account: 'other-account' };
    await writeConfigFile({ oauth: creds, default_text_model: 'first-model' });
    process.env.MMX_CONFIG_DIR = otherDirectory;
    await writeConfigFile({ oauth: otherCreds, default_text_model: 'second-model' });
    process.env.MMX_CONFIG_DIR = directory;
    const first = ensureFreshToken(creds);
    process.env.MMX_CONFIG_DIR = otherDirectory;
    const second = ensureFreshToken(otherCreds);
    const [firstToken, secondToken] = await Promise.all([first, second]);
    expect(refreshes).toBe(2);
    expect(firstToken).not.toBe(secondToken);
    expect(JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8'))).toMatchObject({
      oauth: { access_token: firstToken, account: creds.account }, default_text_model: 'first-model',
    });
    expect(JSON.parse(readFileSync(join(otherDirectory, 'config.json'), 'utf8'))).toMatchObject({
      oauth: { access_token: secondToken, account: otherCreds.account }, default_text_model: 'second-model',
    });
  });

  it('propagates persistence failures to every waiter and clears the pending refresh', async () => {
    let refreshes = 0;
    server = createMockServer({
      routes: { '/oauth2/token': () => {
        refreshes++;
        return jsonResponse({ status: 'success', access_token: 'fresh-access', expired_in: Date.now() + 3600000 });
      } },
    });
    await saveCredentials(creds);
    const blockedPath = join(directory, 'config.json.tmp');
    mkdirSync(blockedPath);
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => ensureFreshToken({ ...creds })));
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    expect(refreshes).toBe(1);
    expect(await loadCredentials()).toEqual(creds);
    rmdirSync(blockedPath);
    expect(await ensureFreshToken(creds)).toBe('fresh-access');
    expect(refreshes).toBe(2);
  });
});
