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
      platformHost: 'https://platform.minimax.io',
      oauthApiHost: 'https://account.minimax.io',
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
      platformHost: 'https://platform.minimax.io',
      oauthApiHost: 'https://account.minimax.io',
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

  it('--subtitles sets subtitle_enable in dry-run output', async () => {
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
        subtitles: true,
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
      expect(parsed.request.subtitle_enable).toBe(true);
      // Verify the old incorrect parameter name is NOT used
      expect(parsed.request.subtitle).toBeUndefined();
    } finally {
      console.log = originalLog;
    }
  });
});

describe('speech synthesize format validation', () => {
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

  const flags = {
    text: 'Hello',
    quiet: false,
    verbose: false,
    noColor: true,
    yes: false,
    dryRun: true,
    help: false,
    nonInteractive: true,
    async: false,
  };

  it('rejects invalid audio format', async () => {
    await expect(
      synthesizeCommand.execute(config, { ...flags, format: 'aac' }),
    ).rejects.toThrow('Invalid audio format "aac"');
  });

  it.each(['mp3', 'pcm', 'flac', 'wav', 'pcmu_raw', 'pcmu_wav', 'opus'])(
    'accepts %s format in dry-run',
    async (fmt) => {
      const originalLog = console.log;
      let output = '';
      console.log = (msg: string) => { output += msg; };
      try {
        await synthesizeCommand.execute(config, { ...flags, format: fmt });
        const parsed = JSON.parse(output);
        expect(parsed.request.audio_setting.format).toBe(fmt);
      } finally {
        console.log = originalLog;
      }
    },
  );

  it('rejects wav in streaming mode', async () => {
    await expect(
      synthesizeCommand.execute(config, { ...flags, format: 'wav', stream: true }),
    ).rejects.toThrow('wav format is not supported in streaming');
  });

  it('defaults opus sample rate to 24000', async () => {
    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };
    try {
      await synthesizeCommand.execute(config, { ...flags, format: 'opus' });
      const parsed = JSON.parse(output);
      expect(parsed.request.audio_setting.sample_rate).toBe(24000);
    } finally {
      console.log = originalLog;
    }
  });

  it('defaults pcmu_wav sample rate to 8000', async () => {
    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };
    try {
      await synthesizeCommand.execute(config, { ...flags, format: 'pcmu_wav' });
      const parsed = JSON.parse(output);
      expect(parsed.request.audio_setting.sample_rate).toBe(8000);
    } finally {
      console.log = originalLog;
    }
  });

  it('respects explicit --sample-rate even for opus', async () => {
    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };
    try {
      await synthesizeCommand.execute(config, { ...flags, format: 'opus', sampleRate: 16000 });
      const parsed = JSON.parse(output);
      expect(parsed.request.audio_setting.sample_rate).toBe(16000);
    } finally {
      console.log = originalLog;
    }
  });
});