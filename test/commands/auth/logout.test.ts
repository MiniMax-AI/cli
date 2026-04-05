import { describe, it, expect } from 'bun:test';
import { default as logoutCommand } from '../../../src/commands/auth/logout';

describe('auth logout command', () => {
  it('has correct name', () => {
    expect(logoutCommand.name).toBe('auth logout');
  });

  it('handles dry run', async () => {
    const config = {
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

    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg + '\n'; };

    try {
      await logoutCommand.execute(config, {
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: true,
        help: false,
        nonInteractive: true,
        async: false,
      });

      expect(output).toContain('No changes made');
    } finally {
      console.log = originalLog;
    }
  });
});
