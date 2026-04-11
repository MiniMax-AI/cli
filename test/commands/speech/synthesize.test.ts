import { describe, it, expect } from 'bun:test';
import { default as synthesizeCommand } from '../../../src/commands/speech/synthesize';

describe('speech synthesize command', () => {
  it('has correct name', () => {
    expect(synthesizeCommand.name).toBe('speech synthesize');
  });

  it('requires text input', async () => {
    const config = {
      apiKey: 'test-key',
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
      synthesizeCommand.execute(config, {
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: false,
        help: false,
        nonInteractive: true,
        async: false,
      }),
    ).rejects.toThrow('--text or --text-file is required');
  });

  it('shows dry run output', async () => {
    const config = {
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

    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    try {
      await synthesizeCommand.execute(config, {
        text: 'Hello',
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: true,
        help: false,
        nonInteractive: true,
        async: false,
      });

      const parsed = JSON.parse(output);
      expect(parsed.request.text).toBe('Hello');
      expect(parsed.request.model).toBe('speech-2.8-hd');
    } finally {
      console.log = originalLog;
    }
  });

  it('uses defaultSpeechModel when --model flag is not provided', async () => {
    const config = {
      apiKey: 'test-key',
      region: 'global' as const,
      baseUrl: 'https://api.mmx.io',
      output: 'json' as const,
      timeout: 10,
      defaultSpeechModel: 'speech-hd',
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
      await synthesizeCommand.execute(config, {
        text: 'Hello',
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: true,
        help: false,
        nonInteractive: true,
        async: false,
      });

      const parsed = JSON.parse(output);
      expect(parsed.request.model).toBe('speech-hd');
    } finally {
      console.log = originalLog;
    }
  });

  it('--model flag overrides defaultSpeechModel', async () => {
    const config = {
      apiKey: 'test-key',
      region: 'global' as const,
      baseUrl: 'https://api.mmx.io',
      output: 'json' as const,
      timeout: 10,
      defaultSpeechModel: 'speech-hd',
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
      await synthesizeCommand.execute(config, {
        text: 'Hello',
        model: 'speech-01-hd',
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: true,
        help: false,
        nonInteractive: true,
        async: false,
      });

      const parsed = JSON.parse(output);
      expect(parsed.request.model).toBe('speech-01-hd');
    } finally {
      console.log = originalLog;
    }
  });
});
