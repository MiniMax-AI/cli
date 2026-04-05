import { describe, it, expect } from 'bun:test';
import { default as showCommand } from '../../../src/commands/quota/show';

describe('quota show command', () => {
  it('has correct name', () => {
    expect(showCommand.name).toBe('quota show');
  });

  it('handles dry run', async () => {
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

    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    try {
      await showCommand.execute(config, {
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: true,
        help: false,
        nonInteractive: true,
        async: false,
      });

      expect(output).toContain('Would fetch quota');
    } finally {
      console.log = originalLog;
    }
  });
});
