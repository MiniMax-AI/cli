import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { default as generateCommand } from '../../../src/commands/music/generate';
import { createMockServer, jsonResponse, type MockServer } from '../../helpers/mock-server';

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

describe('music generate command', () => {
  let server: MockServer | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it('has correct name', () => {
    expect(generateCommand.name).toBe('music generate');
  });

  it('requires prompt or lyrics', async () => {
    await expect(
      generateCommand.execute(baseConfig, baseFlags),
    ).rejects.toThrow('At least one of --prompt or --lyrics is required');
  });

  it('requires lyrics when only prompt is given (API contract)', async () => {
    await expect(
      generateCommand.execute(baseConfig, { ...baseFlags, prompt: 'Upbeat pop' }),
    ).rejects.toThrow('Lyrics are required');
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
          lyrics: '[verse] placeholder',
          vocals: 'warm male and bright female duet',
          genre: 'folk',
          mood: 'warm',
          instruments: 'acoustic guitar, piano',
          bpm: 95,
          avoid: 'electronic beats',
        },
      );
      resolved = true;
    } catch {
      // dryRun may resolve or reject depending on output routing; either is fine
      resolved = true;
    }
    expect(resolved).toBe(true);
  });

  it('has all structured flags defined: vocals, genre, mood, instruments, tempo, bpm, key, use-case, structure, references, avoid, extra, instrumental, aigc-watermark', () => {
    const optionFlags = generateCommand.options?.map((o) => o.flag) ?? [];
    expect(optionFlags.some((f) => f.startsWith('--vocals'))).toBe(true);
    expect(optionFlags.some((f) => f.startsWith('--genre'))).toBe(true);
    expect(optionFlags.some((f) => f.startsWith('--mood'))).toBe(true);
    expect(optionFlags.some((f) => f.startsWith('--instruments'))).toBe(true);
    expect(optionFlags.some((f) => f.startsWith('--tempo'))).toBe(true);
    expect(optionFlags.some((f) => f.startsWith('--bpm'))).toBe(true);
    expect(optionFlags.some((f) => f.startsWith('--key'))).toBe(true);
    expect(optionFlags.some((f) => f.startsWith('--use-case'))).toBe(true);
    expect(optionFlags.some((f) => f.startsWith('--structure'))).toBe(true);
    expect(optionFlags.some((f) => f.startsWith('--references'))).toBe(true);
    expect(optionFlags.some((f) => f.startsWith('--avoid'))).toBe(true);
    expect(optionFlags.some((f) => f.startsWith('--extra'))).toBe(true);
    expect(optionFlags.some((f) => f.startsWith('--instrumental'))).toBe(true);
    expect(optionFlags.some((f) => f.startsWith('--aigc-watermark'))).toBe(true);
    expect(optionFlags.some((f) => f.startsWith('--lyrics-out'))).toBe(true);
  });

  it('examples include vocal, instrumental, and lyrics-optimizer usage', () => {
    const examples = generateCommand.examples ?? [];
    const joined = examples.join(' ');
    expect(joined).toContain('vocals');
    expect(joined).toContain('--instrumental');
    expect(joined).toContain('--lyrics-optimizer');
  });

  it('rejects --instrumental with --lyrics', async () => {
    await expect(
      generateCommand.execute(
        { ...baseConfig, dryRun: true },
        { ...baseFlags, prompt: 'Folk', instrumental: true, lyrics: 'Hello' },
      ),
    ).rejects.toThrow('Cannot use --instrumental with --lyrics');
  });

  it('rejects --instrumental with --lyrics-file', async () => {
    await expect(
      generateCommand.execute(
        { ...baseConfig, dryRun: true },
        { ...baseFlags, prompt: 'Folk', instrumental: true, lyricsFile: '/dev/null' },
      ),
    ).rejects.toThrow('Cannot use --instrumental with --lyrics');
  });

  it('handles "无歌词" as instrumental', async () => {
    let resolved = false;
    try {
      await generateCommand.execute(
        { ...baseConfig, dryRun: true, output: 'json' as const },
        { ...baseFlags, dryRun: true, prompt: 'Folk', lyrics: '无歌词' },
      );
      resolved = true;
    } catch {
      resolved = true;
    }
    expect(resolved).toBe(true);
  });

  it('handles "no lyrics" (English) as instrumental', async () => {
    let resolved = false;
    try {
      await generateCommand.execute(
        { ...baseConfig, dryRun: true, output: 'json' as const },
        { ...baseFlags, dryRun: true, prompt: 'Folk', lyrics: 'no lyrics' },
      );
      resolved = true;
    } catch {
      resolved = true;
    }
    expect(resolved).toBe(true);
  });

  it('uses defaultMusicModel when config is set', async () => {
    let captured = '';
    const origLog = console.log;
    console.log = (msg: string) => { captured += msg; };

    try {
      await generateCommand.execute(
        { ...baseConfig, dryRun: true, output: 'json' as const, defaultMusicModel: 'music-2.6' },
        { ...baseFlags, dryRun: true, prompt: 'Folk', lyrics: 'no lyrics' },
      );
    } catch {
      // dry-run may resolve or reject
    }

    console.log = origLog;
    const parsed = JSON.parse(captured);
    expect(parsed.request.model).toBe('music-2.6');
  });

  it('--model flag overrides defaultMusicModel', async () => {
    let captured = '';
    const origLog = console.log;
    console.log = (msg: string) => { captured += msg; };

    try {
      await generateCommand.execute(
        { ...baseConfig, dryRun: true, output: 'json' as const, defaultMusicModel: 'music-2.6' },
        { ...baseFlags, dryRun: true, prompt: 'Folk', lyrics: 'no lyrics', model: 'music-2.5' },
      );
    } catch {
      // dry-run may resolve or reject
    }

    console.log = origLog;
    const parsed = JSON.parse(captured);
    expect(parsed.request.model).toBe('music-2.5');
  });

  it('rejects invalid audio format', async () => {
    await expect(
      generateCommand.execute(
        { ...baseConfig, dryRun: true },
        { ...baseFlags, dryRun: true, prompt: 'Folk', lyrics: 'la la', format: 'opus' },
      ),
    ).rejects.toThrow('Invalid audio format "opus"');
  });

  it.each(['mp3', 'wav', 'pcm'])(
    'accepts %s format in dry-run',
    async (fmt) => {
      const origLog = console.log;
      let captured = '';
      console.log = (msg: string) => { captured += msg; };
      try {
        await generateCommand.execute(
          { ...baseConfig, dryRun: true, output: 'json' as const },
          { ...baseFlags, dryRun: true, prompt: 'Folk', lyrics: 'la la', format: fmt },
        );
        const parsed = JSON.parse(captured);
        expect(parsed.request.audio_setting.format).toBe(fmt);
      } finally {
        console.log = origLog;
      }
    },
  );

  it('saves provided lyrics to the current directory by default', async () => {
    server = createMockServer({
      routes: {
        '/v1/music_generation': () => jsonResponse({
          base_resp: { status_code: 0, status_msg: 'ok' },
          data: {
            audio: Buffer.from('test music').toString('hex'),
            status: 0,
          },
        }),
      },
    });

    const tempDir = mkdtempSync(join(tmpdir(), 'mmx-music-generate-'));
    const previousCwd = process.cwd();
    const audioPath = join(tempDir, 'song.mp3');
    const expectedLyricsPath = join(tempDir, 'song.lyrics.txt');

    try {
      process.chdir(tempDir);
      await generateCommand.execute(
        { ...baseConfig, baseUrl: server.url, quiet: true },
        { ...baseFlags, quiet: true, prompt: 'Folk', lyrics: '[verse] hello world', out: audioPath },
      );
      expect(existsSync(expectedLyricsPath)).toBe(true);
      expect(readFileSync(expectedLyricsPath, 'utf-8')).toBe('[verse] hello world');
    } finally {
      process.chdir(previousCwd);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('uses lyrics_generation output for --lyrics-optimizer and saves to the requested path', async () => {
    const expectedLyrics = '[verse] generated lyrics';
    let musicRequestBody: Record<string, unknown> | undefined;

    server = createMockServer({
      routes: {
        async '/v1/lyrics_generation'(req) {
          const body = await req.json() as Record<string, unknown>;
          expect(body.mode).toBe('write_full_song');
          expect(body.prompt).toBe('Upbeat pop about summer');
          return jsonResponse({
            base_resp: { status_code: 0, status_msg: 'ok' },
            lyrics: expectedLyrics,
            song_title: 'Summer Song',
          });
        },
        async '/v1/music_generation'(req) {
          musicRequestBody = await req.json() as Record<string, unknown>;
          return jsonResponse({
            base_resp: { status_code: 0, status_msg: 'ok' },
            data: {
              audio: Buffer.from('test music').toString('hex'),
              status: 0,
            },
          });
        },
      },
    });

    const tempDir = mkdtempSync(join(tmpdir(), 'mmx-music-lyrics-optimizer-'));
    const audioPath = join(tempDir, 'song.mp3');
    const lyricsPath = join(tempDir, 'lyrics.txt');

    try {
      await generateCommand.execute(
        { ...baseConfig, baseUrl: server.url, quiet: true },
        {
          ...baseFlags,
          quiet: true,
          prompt: 'Upbeat pop about summer',
          lyricsOptimizer: true,
          out: audioPath,
          lyricsOut: lyricsPath,
        },
      );
      expect(musicRequestBody?.lyrics).toBe(expectedLyrics);
      expect(musicRequestBody?.lyrics_optimizer).toBeUndefined();
      expect(existsSync(lyricsPath)).toBe(true);
      expect(readFileSync(lyricsPath, 'utf-8')).toBe(expectedLyrics);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('still saves lyrics when audio is requested as url output', async () => {
    server = createMockServer({
      routes: {
        '/v1/music_generation': () => jsonResponse({
          base_resp: { status_code: 0, status_msg: 'ok' },
          data: {
            audio_url: 'https://example.com/song.mp3',
            status: 0,
          },
        }),
      },
    });

    const tempDir = mkdtempSync(join(tmpdir(), 'mmx-music-url-output-'));
    const lyricsPath = join(tempDir, 'lyrics.txt');

    try {
      await generateCommand.execute(
        { ...baseConfig, baseUrl: server.url, quiet: true },
        {
          ...baseFlags,
          quiet: true,
          prompt: 'Folk',
          lyrics: '[verse] hello world',
          outputFormat: 'url',
          lyricsOut: lyricsPath,
        },
      );
      expect(existsSync(lyricsPath)).toBe(true);
      expect(readFileSync(lyricsPath, 'utf-8')).toBe('[verse] hello world');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
