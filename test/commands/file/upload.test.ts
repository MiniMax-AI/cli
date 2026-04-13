import { describe, it, expect } from 'bun:test';
import { default as uploadCommand } from '../../../src/commands/file/upload';

describe('file upload command', () => {
  it('has correct name', () => {
    expect(uploadCommand.name).toBe('file upload');
  });

  it('requires file argument', async () => {
    const config = {
      apiKey: 'test-key',
      region: 'global' as const,
      env: 'prod' as const,
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
      uploadCommand.execute(config, {
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: true,
        help: false,
        nonInteractive: true,
        async: false,
      }),
    ).rejects.toThrow('Missing required argument: --file');
  });
});