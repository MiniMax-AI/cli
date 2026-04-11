import { describe, it, expect, mock } from 'bun:test';
import { default as setCommand } from '../../../src/commands/config/set';

// Mock file I/O
mock.module('../../../src/config/loader', () => ({
  readConfigFile: () => ({}),
  writeConfigFile: mock(() => Promise.resolve()),
}));

describe('config set command', () => {
  it('has correct name', () => {
    expect(setCommand.name).toBe('config set');
  });

  it('requires key and value', async () => {
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
      setCommand.execute(config, {
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: false,
        help: false,
        nonInteractive: true,
        async: false,
      }),
    ).rejects.toThrow('--key and --value are required');
  });

  it('validates config key', async () => {
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
      setCommand.execute(config, {
        key: 'invalid_key',
        value: 'test',
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: false,
        help: false,
        nonInteractive: true,
        async: false,
      }),
    ).rejects.toThrow('Invalid config key');
  });

  it('accepts default_text_model key', async () => {
    const config = {
      region: 'global' as const,
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

    // Should not throw — key is valid
    await expect(
      setCommand.execute(config, {
        key: 'default_text_model',
        value: 'MiniMax-M2.7-highspeed',
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: true,
        help: false,
        nonInteractive: true,
        async: false,
      }),
    ).resolves.toBeUndefined();
  });

  it('accepts hyphen alias default-text-model', async () => {
    const config = {
      region: 'global' as const,
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

    // Hyphen alias should resolve to default_text_model
    await expect(
      setCommand.execute(config, {
        key: 'default-text-model',
        value: 'MiniMax-M2.7-highspeed',
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: true,
        help: false,
        nonInteractive: true,
        async: false,
      }),
    ).resolves.toBeUndefined();
  });
});
