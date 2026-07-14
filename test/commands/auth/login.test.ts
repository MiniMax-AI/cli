import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { default as loginCommand } from '../../../src/commands/auth/login';
import { REGIONS } from '../../../src/config/schema';
import { createMockServer, jsonResponse, type MockServer } from '../../helpers/mock-server';

describe('auth login command', () => {
  const originalConfigDir = process.env.MMX_CONFIG_DIR;
  let server: MockServer | undefined;
  let configDir: string | undefined;

  afterEach(() => {
    server?.close();
    if (configDir) rmSync(configDir, { recursive: true, force: true });
    if (originalConfigDir === undefined) delete process.env.MMX_CONFIG_DIR;
    else process.env.MMX_CONFIG_DIR = originalConfigDir;
    server = undefined;
    configDir = undefined;
  });

  it('has correct name and description', () => {
    expect(loginCommand.name).toBe('auth login');
    expect(loginCommand.description).toContain('Authenticate');
  });

  it('requires api key in non-interactive mode', async () => {
    const config = {
      region: 'global' as const,
      baseUrl: 'https://api.mmx.io',
      output: 'text' as const,
      timeout: 10,
      verbose: false,
      quiet: false,
      noColor: true,
      yes: false,
      dryRun: false,
      nonInteractive: true,
      async: false,
    };

    await expect(
      loginCommand.execute(config, {
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: false,
        help: false,
        nonInteractive: true,
        async: false,
      }),
    ).rejects.toThrow('--api-key is required');
  });

  it('honors an explicit region without running auto-detection', async () => {
    let quotaRequests = 0;
    server = createMockServer({
      routes: {
        '/v1/token_plan/remains': () => {
          quotaRequests += 1;
          return jsonResponse({
            model_remains: [],
            base_resp: { status_code: 0, status_msg: 'ok' },
          });
        },
      },
    });

    configDir = mkdtempSync(join(tmpdir(), 'mmx-region-login-'));
    process.env.MMX_CONFIG_DIR = configDir;

    const originalGlobal = REGIONS.global;
    const originalCn = REGIONS.cn;
    (REGIONS as Record<string, string>).global = 'http://127.0.0.1:1';
    (REGIONS as Record<string, string>).cn = server.url;

    try {
      await loginCommand.execute(
        {
          region: 'global',
          baseUrl: originalGlobal,
          output: 'text',
          timeout: 1,
          verbose: false,
          quiet: true,
          noColor: true,
          yes: false,
          dryRun: false,
          nonInteractive: true,
          async: false,
        },
        {
          apiKey: 'cn-test-key',
          region: 'cn',
          quiet: true,
          verbose: false,
          noColor: true,
          yes: false,
          dryRun: false,
          help: false,
          nonInteractive: true,
          async: false,
        },
      );

      expect(quotaRequests).toBe(2);
    } finally {
      (REGIONS as Record<string, string>).global = originalGlobal;
      (REGIONS as Record<string, string>).cn = originalCn;
    }
  });
});
