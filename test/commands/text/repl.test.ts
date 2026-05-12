import { describe, it, expect } from 'bun:test';

describe('text repl command', () => {
  it('is importable and has correct metadata', async () => {
    const mod = await import('../../../src/commands/text/repl');
    const cmd = mod.default;

    expect(cmd.name).toBe('text repl');
    expect(cmd.description).toContain('interactive');
    expect(cmd.options).toBeDefined();

    const options = cmd.options!;
    expect(options.length).toBeGreaterThan(0);

    // Verify key options exist
    const flagNames = options.map(o => o.flag);
    expect(flagNames.some(f => f.includes('model'))).toBe(true);
    expect(flagNames.some(f => f.includes('system'))).toBe(true);
    expect(flagNames.some(f => f.includes('max-tokens'))).toBe(true);
  });

  it('rejects non-interactive mode', async () => {
    const mod = await import('../../../src/commands/text/repl');
    const cmd = mod.default;

    const config = {
      region: 'global' as const,
      baseUrl: 'https://api.minimax.io',
      output: 'text' as const,
      timeout: 300,
      verbose: false,
      quiet: false,
      noColor: true,
      yes: false,
      dryRun: false,
      nonInteractive: true,
      async: false,
    };

    const flags = {
      apiKey: 'sk-test',
      region: 'global' as const,
      baseUrl: 'https://api.minimax.io',
      output: 'text' as const,
      timeout: 300,
      quiet: false,
      verbose: false,
      noColor: true,
      dryRun: false,
      nonInteractive: true,
      help: false,
      version: false,
      async: false,
      yes: false,
      _positional: [] as string[],
    };

    await expect(cmd.execute(config, flags)).rejects.toThrow('interactive');
  });
});
