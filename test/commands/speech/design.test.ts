import { describe, it, expect } from 'bun:test';
import { default as designCommand } from '../../../src/commands/speech/design';

const baseConfig = {
  apiKey: 'test-key',
  region: 'global' as const,
  baseUrl: 'https://api.mmx.io',
  output: 'json' as const,
  timeout: 10,
  verbose: false,
  quiet: false,
  noColor: true,
  yes: false,
  dryRun: true,
  nonInteractive: true,
  async: false,
};

const baseFlags = {
  quiet: false,
  verbose: false,
  noColor: true,
  yes: false,
  dryRun: true,
  help: false,
  nonInteractive: true,
  async: false,
};

describe('speech design command', () => {
  it('has correct name', () => {
    expect(designCommand.name).toBe('speech design');
  });

  it('requires prompt', async () => {
    await expect(
      designCommand.execute(baseConfig, { ...baseFlags, voiceId: 'designed_voice' }),
    ).rejects.toThrow('--prompt is required');
  });

  it('builds design request', async () => {
    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    try {
      await designCommand.execute(baseConfig, {
        ...baseFlags,
        prompt: 'Warm and clear narrator',
        voiceId: 'designed_voice',
      });

      const parsed = JSON.parse(output);
      expect(parsed.request).toEqual({
        prompt: 'Warm and clear narrator',
        voice_id: 'designed_voice',
      });
    } finally {
      console.log = originalLog;
    }
  });
});
