import { describe, it, expect } from 'bun:test';
import { default as queryCommand } from '../../../src/commands/search/query';

describe('search query command', () => {
  it('has correct name', () => {
    expect(queryCommand.name).toBe('search query');
  });

  it('requires q argument', async () => {
    const config = {
      apiKey: 'test-key',
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
      dryRun: true,
      nonInteractive: true,
      async: false,
    };

    await expect(
      queryCommand.execute(config, {
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: true,
        help: false,
        nonInteractive: true,
        async: false,
      }),
    ).rejects.toThrow('--q is required');
  });
});