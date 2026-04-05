import { describe, it, expect } from 'bun:test';
import { default as statusCommand } from '../../../src/commands/auth/status';

describe('auth status command', () => {
  it('has correct name', () => {
    expect(statusCommand.name).toBe('auth status');
  });

  it('shows not authenticated when no credentials', async () => {
    const config = {
      region: 'global' as const,
      baseUrl: 'https://api.minimax.io',
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
