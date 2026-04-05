import { describe, it, expect } from 'bun:test';
import { default as showCommand } from '../../../src/commands/config/show';

describe('config show command', () => {
  it('has correct name', () => {
    expect(showCommand.name).toBe('config show');
  });

  it('shows configuration', async () => {
    const config = {
      apiKey: 'test-key',
      region: 'global' as const,
      baseUrl: 'https://api.minimax.io',
      output: 'json' as const,
      timeout: 300,
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
      await showCommand.execute(config, {
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
      expect(parsed.base_url).toBe('https://api.minimax.io');
      expect(parsed.timeout).toBe(300);
    } finally {
      console.log = originalLog;
    }
  });
});
