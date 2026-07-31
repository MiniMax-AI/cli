import { describe, it, expect } from 'bun:test';
import { default as coverCommand } from '../../../src/commands/music/cover';

const baseConfig = {
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

describe('music cover command', () => {
  it('has correct name', () => {
    expect(coverCommand.name).toBe('music cover');
  });

  it('requires --prompt', async () => {
    await expect(
      coverCommand.execute(baseConfig, baseFlags),
    ).rejects.toThrow('--prompt is required');
  });

  it('requires either --audio or --audio-file', async () => {
    await expect(
      coverCommand.execute(
        baseConfig,
        { ...baseFlags, prompt: 'Indie folk cover' },
      ),
    ).rejects.toThrow('One of --audio <url> or --audio-file <path> is required');
  });

  it('rejects using both --audio and --audio-file', async () => {
    await expect(
      coverCommand.execute(
        baseConfig,
        { ...baseFlags, prompt: 'Indie folk', audio: 'https://example.com/song.mp3', audioFile: '/tmp/ref.mp3' },
      ),
    ).rejects.toThrow('Use either --audio or --audio-file, not both');
  });

  it('builds correct request body in dry-run with --audio', async () => {
    let captured = '';
    const origLog = console.log;
    console.log = (msg: string) => { captured += msg; };

    try {
      await coverCommand.execute(
        { ...baseConfig, dryRun: true, output: 'json' as const },
        {
          ...baseFlags,
          dryRun: true,
          prompt: 'Jazz cover',
          audio: 'https://example.com/ref.mp3',
        },
      );
    } catch {
      // dry-run may resolve or reject
    }

    console.log = origLog;
    const parsed = JSON.parse(captured);
    expect(parsed.request.model).toMatch(/^music-cover/);
    expect(parsed.request.prompt).toBe('Jazz cover');
    expect(parsed.request.audio_url).toBe('https://example.com/ref.mp3');
    expect(parsed.request.output_format).toBe('hex');
  });

  it('accepts optional --lyrics', async () => {
    let captured = '';
    const origLog = console.log;
    console.log = (msg: string) => { captured += msg; };

    try {
      await coverCommand.execute(
        { ...baseConfig, dryRun: true, output: 'json' as const },
        {
          ...baseFlags,
          dryRun: true,
          prompt: 'Pop cover',
          audio: 'https://example.com/ref.mp3',
          lyrics: 'New lyrics here',
        },
      );
    } catch {
      // dry-run may resolve or reject
    }

    console.log = origLog;
    const parsed = JSON.parse(captured);
    expect(parsed.preprocess_request.model).toBe('music-cover');
    expect(parsed.preprocess_request.audio_url).toBe('https://example.com/ref.mp3');
    expect(parsed.request.lyrics).toBe('New lyrics here');
    expect(parsed.request.cover_feature_id).toBe('__cover_feature_id_from_preprocess__');
    expect(parsed.request.audio_url).toBeUndefined();
  });

  it('accepts optional --seed', async () => {
    let captured = '';
    const origLog = console.log;
    console.log = (msg: string) => { captured += msg; };

    try {
      await coverCommand.execute(
        { ...baseConfig, dryRun: true, output: 'json' as const },
        {
          ...baseFlags,
          dryRun: true,
          prompt: 'Rock cover',
          audio: 'https://example.com/ref.mp3',
          seed: 42,
        },
      );
    } catch {
      // dry-run may resolve or reject
    }

    console.log = origLog;
    const parsed = JSON.parse(captured);
    expect(parsed.request.seed).toBe(42);
  });

  it('rejects invalid model', async () => {
    await expect(
      coverCommand.execute(
        { ...baseConfig, dryRun: true },
        {
          ...baseFlags,
          prompt: 'Folk cover',
          audio: 'https://example.com/ref.mp3',
          model: 'music-2.6',
        },
      ),
    ).rejects.toThrow('Invalid model');
  });

  it('accepts the official music-cover-free model', async () => {
    let captured = '';
    const origLog = console.log;
    console.log = (msg: string) => { captured += msg; };

    try {
      await coverCommand.execute(
        { ...baseConfig, dryRun: true, output: 'json' as const },
        {
          ...baseFlags,
          dryRun: true,
          prompt: 'Folk cover',
          audio: 'https://example.com/ref.mp3',
          model: 'music-cover-free',
        },
      );
    } finally {
      console.log = origLog;
    }

    expect(JSON.parse(captured).request.model).toBe('music-cover-free');
  });

  it('rejects invalid audio format', async () => {
    await expect(
      coverCommand.execute(
        { ...baseConfig, dryRun: true },
        {
          ...baseFlags,
          prompt: 'Folk cover',
          audio: 'https://example.com/ref.mp3',
          format: 'opus',
        },
      ),
    ).rejects.toThrow('Invalid audio format');
  });

  it.each(['mp3', 'wav', 'pcm'])(
    'accepts %s format in dry-run',
    async (fmt) => {
      let captured = '';
      const origLog = console.log;
      console.log = (msg: string) => { captured += msg; };
      try {
        await coverCommand.execute(
          { ...baseConfig, dryRun: true, output: 'json' as const },
          {
            ...baseFlags,
            dryRun: true,
            prompt: 'Folk cover',
            audio: 'https://example.com/ref.mp3',
            format: fmt,
          },
        );
        const parsed = JSON.parse(captured);
        expect(parsed.request.audio_setting.format).toBe(fmt);
      } finally {
        console.log = origLog;
      }
    },
  );

  it('has expected options', () => {
    const flags = coverCommand.options?.map(o => o.flag) ?? [];
    expect(flags.some(f => f.startsWith('--audio'))).toBe(true);
    expect(flags.some(f => f.startsWith('--audio-file'))).toBe(true);
    expect(flags.some(f => f.startsWith('--lyrics'))).toBe(true);
    expect(flags.some(f => f.startsWith('--seed'))).toBe(true);
    expect(flags.some(f => f.startsWith('--format'))).toBe(true);
    expect(flags.some(f => f.startsWith('--out'))).toBe(true);
  });

  it('has examples with --audio and --audio-file usage', () => {
    const examples = coverCommand.examples ?? [];
    const joined = examples.join(' ');
    expect(joined).toContain('--audio');
    expect(joined).toContain('--audio-file');
  });
});
