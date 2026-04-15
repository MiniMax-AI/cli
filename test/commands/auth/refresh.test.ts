import { describe, it, expect } from 'bun:test';
import { default as refreshCommand } from '../../../src/commands/auth/refresh';

describe('auth refresh command', () => {
  it('has correct name', () => {
    expect(refreshCommand.name).toBe('auth refresh');
  });

  it('errors when not using OAuth', async () => {
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
      refreshCommand.execute(config, {
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: false,
        help: false,
        nonInteractive: true,
        async: false,
      }),
    ).rejects.toThrow('not authenticated via OAuth');
  });
});
