import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { default as loginCommand } from '../../../src/commands/auth/login';
import { readConfigFile, writeConfigFile } from '../../../src/config/loader';
import { REGIONS } from '../../../src/config/schema';
import { CLIError } from '../../../src/errors/base';
import { ExitCode } from '../../../src/errors/codes';
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
      expect(readConfigFile()).toMatchObject({
        api_key: 'cn-test-key',
        region: 'cn',
      });
    } finally {
      (REGIONS as Record<string, string>).global = originalGlobal;
      (REGIONS as Record<string, string>).cn = originalCn;
    }
  });

  it('does not save an explicitly selected region when authentication is rejected', async () => {
    server = createMockServer({
      routes: {
        '/v1/token_plan/remains': () => jsonResponse({ error: 'unauthorized' }, 401),
      },
    });

    configDir = mkdtempSync(join(tmpdir(), 'mmx-region-login-'));
    process.env.MMX_CONFIG_DIR = configDir;
    await writeConfigFile({ api_key: 'existing-key', region: 'global' });

    const originalCn = REGIONS.cn;
    (REGIONS as Record<string, string>).cn = server.url;

    try {
      try {
        await loginCommand.execute(
          {
            region: 'global',
            baseUrl: REGIONS.global,
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
            apiKey: 'rejected-key',
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
        throw new Error('Expected API key validation to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(CLIError);
        expect((error as CLIError).exitCode).toBe(ExitCode.AUTH);
      }

      expect(readConfigFile()).toEqual({ api_key: 'existing-key', region: 'global' });
    } finally {
      (REGIONS as Record<string, string>).cn = originalCn;
    }
  });

  it('warns and saves an explicit region when its endpoint is unreachable', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'mmx-region-login-'));
    process.env.MMX_CONFIG_DIR = configDir;
    await writeConfigFile({ api_key: 'existing-key', region: 'global' });

    const originalCn = REGIONS.cn;
    (REGIONS as Record<string, string>).cn = 'http://127.0.0.1:1';
    const originalWrite = process.stderr.write.bind(process.stderr);
    let stderr = '';
    (process.stderr as NodeJS.WriteStream).write = (chunk: unknown) => {
      stderr += String(chunk);
      return true;
    };

    try {
      await loginCommand.execute(
        {
          region: 'global',
          baseUrl: REGIONS.global,
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
          apiKey: 'explicit-cn-key',
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

      expect(readConfigFile()).toEqual({ api_key: 'explicit-cn-key', region: 'cn' });
      expect(stderr).toContain('Warning: Could not validate the API key');
      expect(stderr).toContain('Saving the explicitly selected region "cn"');
    } finally {
      (process.stderr as NodeJS.WriteStream).write = originalWrite;
      (REGIONS as Record<string, string>).cn = originalCn;
    }
  });

  it('keeps existing credentials when auto-detection cannot reach either region', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'mmx-region-login-'));
    process.env.MMX_CONFIG_DIR = configDir;
    await writeConfigFile({ api_key: 'existing-key', region: 'cn' });

    const originalGlobal = REGIONS.global;
    const originalCn = REGIONS.cn;
    (REGIONS as Record<string, string>).global = 'http://127.0.0.1:1';
    (REGIONS as Record<string, string>).cn = 'http://127.0.0.1:1';

    try {
      try {
        await loginCommand.execute(
          {
            region: 'cn',
            baseUrl: originalCn,
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
            apiKey: 'unverifiable-key',
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
        throw new Error('Expected region detection to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(CLIError);
        expect((error as CLIError).exitCode).toBe(ExitCode.NETWORK);
      }

      expect(readConfigFile()).toEqual({ api_key: 'existing-key', region: 'cn' });
    } finally {
      (REGIONS as Record<string, string>).global = originalGlobal;
      (REGIONS as Record<string, string>).cn = originalCn;
    }
  });
});
