import { describe, it, expect } from 'bun:test';
import { default as generateCommand } from '../../../src/commands/video/generate';

describe('video generate command', () => {
  it('has correct name', () => {
    expect(generateCommand.name).toBe('video generate');
  });

  it('requires prompt', async () => {
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
      generateCommand.execute(config, {
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: false,
        help: false,
        nonInteractive: true,
        async: false,
      }),
    ).rejects.toThrow('Missing required argument: --prompt');
  });

  it('uses defaultVideoModel when --model flag is not provided', async () => {
    const config = {
      apiKey: 'test-key',
      region: 'global' as const,
      baseUrl: 'https://api.mmx.io',
      output: 'json' as const,
      timeout: 10,
      defaultVideoModel: 'MiniMax-Hailuo-2.3-6s-768p',
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
      await generateCommand.execute(config, {
        prompt: 'A cat',
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
      expect(parsed.request.model).toBe('MiniMax-Hailuo-2.3-6s-768p');
    } finally {
      console.log = originalLog;
    }
  });

  it('auto-switch (--lastFrame) overrides defaultVideoModel', async () => {
    const config = {
      apiKey: 'test-key',
      region: 'global' as const,
      baseUrl: 'https://api.mmx.io',
      output: 'json' as const,
      timeout: 10,
      defaultVideoModel: 'MiniMax-Hailuo-2.3-6s-768p',
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
      // Use HTTP URLs to avoid file system read
      await generateCommand.execute(config, {
        prompt: 'A cat',
        firstFrame: 'https://example.com/first.png',
        lastFrame: 'https://example.com/last.png',
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
      expect(parsed.request.model).toBe('MiniMax-Hailuo-02');
    } finally {
      console.log = originalLog;
    }
  });

  it('--model flag overrides everything', async () => {
    const config = {
      apiKey: 'test-key',
      region: 'global' as const,
      baseUrl: 'https://api.mmx.io',
      output: 'json' as const,
      timeout: 10,
      defaultVideoModel: 'MiniMax-Hailuo-2.3-6s-768p',
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
      await generateCommand.execute(config, {
        prompt: 'A cat',
        model: 'MiniMax-Hailuo-2.3',
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
      expect(parsed.request.model).toBe('MiniMax-Hailuo-2.3');
    } finally {
      console.log = originalLog;
    }
  });
});
