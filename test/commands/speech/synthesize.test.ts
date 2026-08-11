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

  it('--pronunciation serializes multiple values with the API-compatible shape', async () => {
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
        text: '处理这个危险的情况。',
        pronunciation: [
          '处理/(chu3)(li3)',
          '危险/dangerous',
        ],
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

      // pronunciation_dict is an object with a tone string array — not the
      // old array-of-{text,tone} shape — and each value is preserved verbatim
      // (no splitting, trimming, or rewriting), covering both the pinyin form
      // and the plain-replacement form shown in the official API docs.
      expect(Array.isArray(parsed.request.pronunciation_dict)).toBe(false);
      expect(parsed.request.pronunciation_dict).toEqual({
        tone: [
          '处理/(chu3)(li3)',
          '危险/dangerous',
        ],
      });
    } finally {
      console.log = originalLog;
    }
  });

  it('--pronunciation with a single value serializes under tone', async () => {
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
        text: 'Omg, the real danger is not that computers start thinking.',
        pronunciation: ['Omg/Oh my god'],
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

      expect(parsed.request.pronunciation_dict).toEqual({
        tone: ['Omg/Oh my god'],
      });
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

describe('speech synthesize voice_setting flags', () => {
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

  async function dryRunRequest(extraFlags: Record<string, unknown>) {
    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };
    try {
      await synthesizeCommand.execute(config, { ...flags, ...extraFlags });
      return JSON.parse(output).request;
    } finally {
      console.log = originalLog;
    }
  }

  it('--emotion sets voice_setting.emotion', async () => {
    const request = await dryRunRequest({ emotion: 'happy' });
    expect(request.voice_setting.emotion).toBe('happy');
  });

  it('--emotion passes through arbitrary values without local validation', async () => {
    const request = await dryRunRequest({ emotion: 'bored' });
    expect(request.voice_setting.emotion).toBe('bored');
  });

  it('omits voice_setting.emotion when --emotion is not provided', async () => {
    const request = await dryRunRequest({});
    expect(request.voice_setting.emotion).toBeUndefined();
  });

  it('--text-normalization sets voice_setting.text_normalization', async () => {
    const request = await dryRunRequest({ textNormalization: true });
    expect(request.voice_setting.text_normalization).toBe(true);
  });

  it('--latex-read sets voice_setting.latex_read', async () => {
    const request = await dryRunRequest({ latexRead: true });
    expect(request.voice_setting.latex_read).toBe(true);
  });
});
