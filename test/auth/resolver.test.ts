import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { resolveCredential } from '../../src/auth/resolver';
import { ensureAuth } from '../../src/auth/setup';
import { CLIError } from '../../src/errors/base';
import type { Config } from '../../src/config/schema';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    region: 'global' as const,
      baseUrl: 'https://api.mmx.io',
    output: 'text',
    timeout: 300,
    verbose: false,
    quiet: false,
    noColor: false,
    yes: false,
    dryRun: false,
    nonInteractive: false,
    async: false,
    ...overrides,
  };
}

describe('resolveCredential', () => {
  const testDir = join(tmpdir(), `mmx-resolver-test-${Date.now()}`);
  let originalConfigDir: string | undefined;
  let originalApiKey: string | undefined;

  beforeEach(() => {
    originalConfigDir = process.env.MMX_CONFIG_DIR;
    originalApiKey = process.env.MINIMAX_API_KEY;
    const configDir = join(testDir, '.mmx');
    mkdirSync(configDir, { recursive: true });
    process.env.MMX_CONFIG_DIR = configDir;
    delete process.env.MINIMAX_API_KEY;
  });

  afterEach(() => {
    if (originalConfigDir !== undefined) process.env.MMX_CONFIG_DIR = originalConfigDir;
    else delete process.env.MMX_CONFIG_DIR;
    if (originalApiKey !== undefined) process.env.MINIMAX_API_KEY = originalApiKey;
    else delete process.env.MINIMAX_API_KEY;
    rmSync(testDir, { recursive: true, force: true });
  });

  it('resolves from flag (apiKey in config)', async () => {
    const config = makeConfig({ apiKey: 'sk-from-flag' });
    const cred = await resolveCredential(config);
    expect(cred.token).toBe('sk-from-flag');
    expect(cred.method).toBe('api-key');
  });

  it('preserves the environment credential source', async () => {
    const config = makeConfig({
      apiKey: 'sk-from-env',
      apiKeySource: 'env',
    });
    const cred = await resolveCredential(config);
    expect(cred.token).toBe('sk-from-env');
    expect(cred.method).toBe('api-key');
    expect(cred.source).toBe('env');
  });

  it('resolves from config file api key', async () => {
    const config = makeConfig({ fileApiKey: 'sk-from-file' });
    const cred = await resolveCredential(config);
    expect(cred.token).toBe('sk-from-file');
    expect(cred.method).toBe('api-key');
    expect(cred.source).toBe('config.json');
  });

  it('throws when no credentials found', async () => {
    const config = makeConfig();
    await expect(resolveCredential(config)).rejects.toThrow('No credentials found');
  });

  it('no-credentials hint mentions MMX_CONFIG_DIR and working remediation options', async () => {
    const config = makeConfig();
    try {
      await resolveCredential(config);
      throw new Error('expected resolveCredential to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      const hint = (err as CLIError).hint ?? '';
      expect(hint).toContain('mmx auth login');
      expect(hint).toContain('--api-key');
      expect(hint).toContain('MMX_CONFIG_DIR');
      expect(hint).toContain(join(testDir, '.mmx', 'config.json'));
    }
  });

  it('prefers flag over file api key', async () => {
    const config = makeConfig({ apiKey: 'sk-flag', fileApiKey: 'sk-file' });
    const cred = await resolveCredential(config);
    expect(cred.token).toBe('sk-flag');
  });
});

describe('ensureAuth (non-interactive, no credentials)', () => {
  const testDir = join(tmpdir(), `mmx-setup-test-${Date.now()}`);
  let originalConfigDir: string | undefined;
  let originalApiKey: string | undefined;

  beforeEach(() => {
    originalConfigDir = process.env.MMX_CONFIG_DIR;
    originalApiKey = process.env.MINIMAX_API_KEY;
    mkdirSync(join(testDir, '.mmx'), { recursive: true });
    process.env.MMX_CONFIG_DIR = join(testDir, '.mmx');
    delete process.env.MINIMAX_API_KEY;
  });

  afterEach(() => {
    if (originalConfigDir !== undefined) process.env.MMX_CONFIG_DIR = originalConfigDir;
    else delete process.env.MMX_CONFIG_DIR;
    if (originalApiKey !== undefined) process.env.MINIMAX_API_KEY = originalApiKey;
    else delete process.env.MINIMAX_API_KEY;
    rmSync(testDir, { recursive: true, force: true });
  });

  it('no-credentials hint mentions MMX_CONFIG_DIR and working remediation options', async () => {
    const config = makeConfig({ nonInteractive: true });
    try {
      await ensureAuth(config);
      throw new Error('expected ensureAuth to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      const hint = (err as CLIError).hint ?? '';
      expect(hint).toContain('mmx auth login');
      expect(hint).toContain('--api-key');
      expect(hint).toContain('MMX_CONFIG_DIR');
      expect(hint).toContain(join(testDir, '.mmx', 'config.json'));
    }
  });
});
