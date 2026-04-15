import { describe, it, expect } from 'bun:test';
import { default as loginCommand } from '../../../src/commands/auth/login';

describe('auth login command', () => {
  it('has correct name and description', () => {
    expect(loginCommand.name).toBe('auth login');
    expect(loginCommand.description).toContain('Authenticate');
  });

  it('requires api key when method is api-key', async () => {
    const config = {
      region: 'global' as const,
      platformHost: 'https://platform.minimax.io',
      oauthApiHost: 'https://account.minimax.io',
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
        method: 'api-key',
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
});
