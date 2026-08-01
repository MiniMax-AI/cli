import { afterEach, describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { default as statusCommand } from '../../../src/commands/auth/status';

describe('auth status command', () => {
  const originalConfigDir = process.env.MMX_CONFIG_DIR;
  let configDir: string | undefined;

  afterEach(() => {
    if (configDir) rmSync(configDir, { recursive: true, force: true });
    if (originalConfigDir === undefined) delete process.env.MMX_CONFIG_DIR;
    else process.env.MMX_CONFIG_DIR = originalConfigDir;
    configDir = undefined;
  });

  it('has correct name', () => {
    expect(statusCommand.name).toBe('auth status');
  });

  it('shows not authenticated when no credentials', async () => {
    configDir = mkdtempSync(join(tmpdir(), 'mmx-status-test-'));
    process.env.MMX_CONFIG_DIR = configDir;

    const config = {
      region: 'global' as const,
      baseUrl: 'https://api.mmx.io',
      output: 'json' as const,
      timeout: 10,
      verbose: false,
      quiet: false,
      noColor: true,
      yes: false,
      dryRun: false,
      nonInteractive: true,
      async: false,
    };

    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    try {
      await statusCommand.execute(config, {
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: false,
        help: false,
        nonInteractive: true,
        async: false,
      });

      const parsed = JSON.parse(output);
      expect(parsed.authenticated).toBe(false);
    } finally {
      console.log = originalLog;
    }
  });
});
