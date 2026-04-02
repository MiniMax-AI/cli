import { describe, it, expect, afterEach } from 'bun:test';
import { resolveCredential } from '../../src/auth/resolver';
import type { Config } from '../../src/config/schema';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    region: 'global' as const,
      baseUrl: 'https://api.minimax.io',
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
  afterEach(() => {
    delete process.env.MINIMAX_API_KEY;
  });

  it('resolves from flag (apiKey in config)', async () => {
    const config = makeConfig({ apiKey: 'sk-from-flag' });
    const cred = await resolveCredential(config);
    expect(cred.token).toBe('sk-from-flag');
    expect(cred.method).toBe('api-key');
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

  it('prefers flag over file api key', async () => {
    const config = makeConfig({ apiKey: 'sk-flag', fileApiKey: 'sk-file' });
    const cred = await resolveCredential(config);
    expect(cred.token).toBe('sk-flag');
  });
});
