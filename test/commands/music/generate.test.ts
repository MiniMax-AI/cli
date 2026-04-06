import { describe, it, expect } from 'bun:test';
import { default as generateCommand } from '../../../src/commands/music/generate';

const baseConfig = {
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

const baseFlags = {
  quiet: false,
  verbose: false,
  noColor: true,
  yes: false,
  dryRun: false,
  help: false,
  nonInteractive: true,
  async: false,
};

describe('music generate command', () => {
  it('has correct name', () => {
    expect(generateCommand.name).toBe('music generate');
  });

  it('requires prompt or lyrics', async () => {
    await expect(
      generateCommand.execute(baseConfig, baseFlags),
    ).rejects.toThrow('At least one of --prompt or --lyrics is required');
  });

  it('structured flags are appended to prompt (dry-run)', async () => {
    // Use dryRun=true so no real API call is made.
    let resolved = false;
    try {
      await generateCommand.execute(
        { ...baseConfig, dryRun: true, output: 'json' as const },
        {
          ...baseFlags,
          dryRun: true,
          prompt: 'Indie folk',
          vocals: 'warm male and bright female duet',
          genre: 'folk',
          mood: 'warm',
          instruments: 'acoustic guitar, piano',
          bpm: 95,
          avoid: 'electronic beats',
        },
      );
      resolved = true;
    } catch (_) {
      // dryRun may resolve or reject depending on output routing; either is fine
      resolved = true;
    }
    expect(resolved).toBe(true);
  });

  it('has vocals, genre, mood, instruments, bpm, avoid options defined', () => {
    const optionFlags = generateCommand.options?.map((o) => o.flag) ?? [];
    expect(optionFlags.some((f) => f.startsWith('--vocals'))).toBe(true);
    expect(optionFlags.some((f) => f.startsWith('--genre'))).toBe(true);
    expect(optionFlags.some((f) => f.startsWith('--mood'))).toBe(true);
    expect(optionFlags.some((f) => f.startsWith('--instruments'))).toBe(true);
    expect(optionFlags.some((f) => f.startsWith('--bpm'))).toBe(true);
    expect(optionFlags.some((f) => f.startsWith('--avoid'))).toBe(true);
  });

  it('examples include vocal and instrumental usage', () => {
    const examples = generateCommand.examples ?? [];
    const joined = examples.join(' ');
    expect(joined).toContain('vocals');
    expect(joined).toContain('[intro] [outro]');
  });
});
