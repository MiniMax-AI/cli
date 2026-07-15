import { describe, expect, it, spyOn } from 'bun:test';
import { default as setCommand } from '../../../src/commands/config/set';
import * as configLoader from '../../../src/config/loader';

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

  it('masks api_key in dry-run output', async () => {
    const apiKey = 'sk-test-secret-123456';
    const writeConfigFile = spyOn(configLoader, 'writeConfigFile').mockResolvedValue();
    let output = '';
    const originalLog = console.log;
    console.log = (message: string) => { output += message; };

    try {
      await setCommand.execute({
        region: 'global',
        baseUrl: 'https://api.mmx.io',
        output: 'json',
        timeout: 10,
        verbose: false,
        quiet: false,
        noColor: true,
        yes: false,
        dryRun: true,
        nonInteractive: true,
        async: false,
      }, {
        key: 'api_key',
        value: apiKey,
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: true,
        help: false,
        nonInteractive: true,
        async: false,
      });
    } finally {
      console.log = originalLog;
      writeConfigFile.mockRestore();
    }

    expect(output).not.toContain(apiKey);
    expect(JSON.parse(output).would_set.api_key).toBe('sk-t...3456');
    expect(writeConfigFile).not.toHaveBeenCalled();
  });

  it('removes OAuth and masks output when setting api_key', async () => {
    const apiKey = 'sk-test-secret-123456';
    const readConfigFile = spyOn(configLoader, 'readConfigFile').mockReturnValue({
      region: 'cn',
      oauth: {
        access_token: 'old-access-token',
        refresh_token: 'old-refresh-token',
        expires_at: '2099-01-01T00:00:00.000Z',
      },
    });
    let writtenConfig: Record<string, unknown> | undefined;
    const writeConfigFile = spyOn(configLoader, 'writeConfigFile').mockImplementation(async (data) => {
      writtenConfig = { ...data };
    });
    let output = '';
    const originalLog = console.log;
    console.log = (message: string) => { output += message; };

    try {
      await setCommand.execute({
        region: 'cn',
        baseUrl: 'https://api.mmx.io',
        output: 'json',
        timeout: 10,
        verbose: false,
        quiet: false,
        noColor: true,
        yes: false,
        dryRun: false,
        nonInteractive: true,
        async: false,
      }, {
        key: 'api_key',
        value: `  ${apiKey}  `,
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: false,
        help: false,
        nonInteractive: true,
        async: false,
      });
    } finally {
      console.log = originalLog;
      readConfigFile.mockRestore();
      writeConfigFile.mockRestore();
    }

    expect(writtenConfig).toEqual({ api_key: apiKey });
    expect(output).not.toContain(apiKey);
    expect(JSON.parse(output).api_key).toBe('sk-t...3456');
  });

  it('rejects empty api_key values without changing existing credentials', async () => {
    const readConfigFile = spyOn(configLoader, 'readConfigFile');
    const writeConfigFile = spyOn(configLoader, 'writeConfigFile').mockResolvedValue();

    try {
      for (const value of ['', '   ']) {
        await expect(setCommand.execute({
          region: 'cn',
          baseUrl: 'https://api.mmx.io',
          output: 'json',
          timeout: 10,
          verbose: false,
          quiet: false,
          noColor: true,
          yes: false,
          dryRun: false,
          nonInteractive: true,
          async: false,
        }, {
          key: 'api_key',
          value,
          quiet: false,
          verbose: false,
          noColor: true,
          yes: false,
          dryRun: false,
          help: false,
          nonInteractive: true,
          async: false,
        })).rejects.toThrow('must not be empty');
      }
    } finally {
      readConfigFile.mockRestore();
      writeConfigFile.mockRestore();
    }

    expect(readConfigFile).not.toHaveBeenCalled();
    expect(writeConfigFile).not.toHaveBeenCalled();
  });
});
