import { describe, it, expect } from 'bun:test';
import { default as generateCommand } from '../../../src/commands/image/generate';

describe('image generate command', () => {
  it('has correct name', () => {
    expect(generateCommand.name).toBe('image generate');
  });

  it('requires prompt', async () => {
    const config = {
      apiKey: 'test-key',
      region: 'global' as const,
      baseUrl: 'https://api.minimax.io',
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
      generateCommand.execute(config, {
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: false,
        help: false,
        nonInteractive: true,
        async: false,
      }),
    ).rejects.toThrow('Missing required argument: --prompt');
  });
});
