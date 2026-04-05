import { describe, it, expect } from 'bun:test';
import { default as describeCommand } from '../../../src/commands/vision/describe';

describe('vision describe command', () => {
  it('has correct name', () => {
    expect(describeCommand.name).toBe('vision describe');
  });

  it('requires either image or fileId', async () => {
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
      dryRun: true,
      nonInteractive: true,
      async: false,
    };

    await expect(
      describeCommand.execute(config, {
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: true,
        help: false,
        nonInteractive: true,
        async: false,
      }),
    ).rejects.toThrow('Missing required argument');
  });

  it('rejects both image and fileId', async () => {
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
      dryRun: true,
      nonInteractive: true,
      async: false,
    };

    await expect(
      describeCommand.execute(config, {
        image: 'test.jpg',
        fileId: 'file-123',
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: true,
        help: false,
        nonInteractive: true,
        async: false,
      }),
    ).rejects.toThrow('Conflicting arguments');
  });
});