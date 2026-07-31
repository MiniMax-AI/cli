import { describe, it, expect, afterEach } from 'bun:test';
import { createMockServer, jsonResponse, sseResponse, type MockServer } from '../helpers/mock-server';
import { MiniMaxSDK } from '../../src/sdk';
import { MusicSDK, type MusicGenerateRequest } from '../../src/sdk/music';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { MusicResponse } from '../../src/types/api';

function makeMusicResponse(hexAudio?: string): MusicResponse {
  return {
    base_resp: { status_code: 0, status_msg: 'ok' },
    data: {
      audio: hexAudio || Buffer.from('hello music audio').toString('hex'),
      status: 0,
    },
  };
}

async function collectAudio(
  stream: AsyncGenerator<Uint8Array<ArrayBuffer>>,
): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

describe('MiniMaxSDK.music', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
  });

  it('maps the instrumental alias to the official field and accepts the free model', async () => {
    let requestBody: Record<string, unknown> | undefined;
    server = createMockServer({
      routes: {
        '/v1/music_generation': async (req) => {
          requestBody = await req.json() as Record<string, unknown>;
          return jsonResponse({
            data: { audio_url: 'https://example.com/music.mp3' },
            base_resp: { status_code: 0, status_msg: 'success' },
          });
        },
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });

    const result = await sdk.music.generate({
      model: 'music-2.6-free',
      prompt: 'Cinematic orchestral',
      genre: 'soundtrack',
      instrumental: true,
    });

    expect(result.data.audio_url).toBe('https://example.com/music.mp3');
    expect(requestBody?.model).toBe('music-2.6-free');
    expect(requestBody?.is_instrumental).toBe(true);
    expect(requestBody?.instrumental).toBeUndefined();
    expect(requestBody?.genre).toBeUndefined();
    expect(requestBody?.prompt).toContain('Genre: soundtrack');
  });

  it('decodes SSE hex payloads into streaming audio bytes', async () => {
    server = createMockServer({
      routes: {
        '/v1/music_generation': () => sseResponse([
          { data: JSON.stringify({ data: { audio: '4142', status: 1 } }) },
          { data: JSON.stringify({ data: { audio: '4344', status: 1 } }) },
          { data: JSON.stringify({ data: { audio: '4546', status: 2 } }) },
        ]),
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });
    const stream = await sdk.music.generate({
      prompt: 'Upbeat pop',
      lyrics: '[verse] Hello world',
      stream: true,
    });
    const audio = await collectAudio(stream);

    expect(audio.toString()).toBe('ABCDEF');
  });

  it('throws when a streaming request returns a JSON business error', async () => {
    server = createMockServer({
      routes: {
        '/v1/music_generation': () => jsonResponse({
          base_resp: {
            status_code: 1008,
            status_msg: 'insufficient balance',
          },
        }),
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });
    const stream = await sdk.music.generate({
      prompt: 'Upbeat pop',
      lyrics: '[verse] Hello world',
      stream: true,
    });

    await expect(collectAudio(stream)).rejects.toThrow('insufficient balance');
  });

  it('supports one-step covers without replacement lyrics', async () => {
    let requestBody: Record<string, unknown> | undefined;
    server = createMockServer({
      routes: {
        '/v1/music_generation': async (req) => {
          requestBody = await req.json() as Record<string, unknown>;
          return jsonResponse({
            data: { audio_url: 'https://example.com/cover.mp3', status: 2 },
            base_resp: { status_code: 0, status_msg: 'success' },
          });
        },
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });
    const result = await sdk.music.generate({
      model: 'music-cover-free',
      prompt: 'Jazz piano trio with warm intimate vocals',
      audio_url: 'https://example.com/reference.mp3',
      is_instrumental: false,
      lyrics_optimizer: false,
      output_format: 'url',
    });

    expect(result.data.audio_url).toBe('https://example.com/cover.mp3');
    expect(requestBody?.model).toBe('music-cover-free');
    expect(requestBody?.audio_url).toBe('https://example.com/reference.mp3');
    expect(requestBody?.lyrics).toBeUndefined();
    expect(requestBody?.is_instrumental).toBeUndefined();
    expect(requestBody?.lyrics_optimizer).toBeUndefined();
  });

  it('supports two-step covers with replacement lyrics', async () => {
    let requestBody: Record<string, unknown> | undefined;
    server = createMockServer({
      routes: {
        '/v1/music_generation': async (req) => {
          requestBody = await req.json() as Record<string, unknown>;
          return jsonResponse({
            data: { audio: '4142', status: 2 },
            base_resp: { status_code: 0, status_msg: 'success' },
          });
        },
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });
    await sdk.music.generate({
      model: 'music-cover',
      prompt: 'Acoustic folk with gentle strings and soft vocals',
      cover_feature_id: 'cover-feature-id',
      lyrics: '[Verse] These are replacement lyrics for the song',
    });

    expect(requestBody?.model).toBe('music-cover');
    expect(requestBody?.cover_feature_id).toBe('cover-feature-id');
    expect(requestBody?.lyrics).toContain('replacement lyrics');
    expect(requestBody?.audio_url).toBeUndefined();
  });
});

describe('MusicSDK.save', () => {
  const sdk = new MusicSDK({ apiKey: 'sk-test', region: 'global' });

  it('decodes hex audio and saves to disk', () => {
    const out = join(tmpdir(), `music-sdk-save-${Date.now()}.mp3`);
    const response = makeMusicResponse();

    const saved = sdk.save(response, out);
    expect(saved).toBe(out);
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out).toString()).toBe('hello music audio');
    unlinkSync(out);
  });

  it('generates default filename with timestamp', () => {
    const response = makeMusicResponse();
    const saved = sdk.save(response);
    expect(saved).toMatch(/music_\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.mp3/);
    expect(existsSync(saved)).toBe(true);
    unlinkSync(saved);
  });

  it('creates intermediate directories', () => {
    const out = join(tmpdir(), `music-sdk-deep-${Date.now()}`, 'x', 'y', 'song.wav');
    const response = makeMusicResponse();
    const saved = sdk.save(response, out, 'wav');
    expect(existsSync(saved)).toBe(true);
    unlinkSync(saved);
  });

  it('throws when audio data is missing', () => {
    const response = makeMusicResponse('');
    response.data.audio = undefined;
    expect(() => sdk.save(response, '/tmp/test.mp3')).toThrow('missing audio data');
  });
});

describe('MusicSDK.validateParams', () => {
  const sdk = new MusicSDK({ apiKey: 'sk-test', region: 'global' });

  it('throws when is_instrumental and lyrics are both provided', async () => {
    await expect(
      sdk.generate({ is_instrumental: true, lyrics: 'hello' }),
    ).rejects.toThrow('Cannot use is_instrumental with lyrics');
  });

  it('throws when lyrics_optimizer is used with lyrics', async () => {
    await expect(
      sdk.generate({ lyrics_optimizer: true, lyrics: 'hello' }),
    ).rejects.toThrow('Cannot use lyrics_optimizer with lyrics or is_instrumental');
  });

  it('throws when lyrics_optimizer is used with is_instrumental', async () => {
    await expect(
      sdk.generate({ lyrics_optimizer: true, is_instrumental: true }),
    ).rejects.toThrow('Cannot use lyrics_optimizer with lyrics or is_instrumental');
  });

  it('throws when no prompt, lyrics, is_instrumental, or lyrics_optimizer', async () => {
    await expect(
      sdk.generate({}),
    ).rejects.toThrow('At least one of prompt or lyrics or is_instrumental or lyrics_optimizer is required');
  });

  it('throws when lyrics is missing (not is_instrumental, not lyrics_optimizer)', async () => {
    await expect(
      sdk.generate({ prompt: 'Upbeat pop' }),
    ).rejects.toThrow('lyrics is required');
  });

  it('requires prompt for instrumental generation', async () => {
    await expect(
      sdk.generate({ is_instrumental: true }),
    ).rejects.toThrow('prompt is required with is_instrumental');
  });

  it('rejects conflicting instrumental aliases', async () => {
    await expect(
      sdk.generate({
        prompt: 'Cinematic',
        instrumental: true,
        is_instrumental: false,
      }),
    ).rejects.toThrow('instrumental and is_instrumental must not conflict');
  });

  it('throws on invalid model', async () => {
    await expect(
      sdk.generate({ prompt: 'Folk', lyrics: 'no lyrics', model: 'music-2.0' }),
    ).rejects.toThrow('Invalid model');
  });

  it('requires exactly one audio source for cover models', async () => {
    await expect(
      sdk.generate({
        model: 'music-cover-free',
        prompt: 'Jazz piano trio with warm intimate vocals',
      }),
    ).rejects.toThrow('Exactly one of audio_url, audio_base64, or cover_feature_id');

    await expect(
      sdk.generate({
        model: 'music-cover',
        prompt: 'Jazz piano trio with warm intimate vocals',
        audio_url: 'https://example.com/reference.mp3',
        cover_feature_id: 'cover-feature-id',
      }),
    ).rejects.toThrow('Exactly one of audio_url, audio_base64, or cover_feature_id');
  });

  it('requires replacement lyrics with cover_feature_id', async () => {
    await expect(
      sdk.generate({
        model: 'music-cover',
        prompt: 'Jazz piano trio with warm intimate vocals',
        cover_feature_id: 'cover-feature-id',
      }),
    ).rejects.toThrow('lyrics is required with cover_feature_id');
  });

  it('rejects generation-only options for cover models', async () => {
    await expect(
      sdk.generate({
        model: 'music-cover',
        prompt: 'Jazz piano trio with warm intimate vocals',
        audio_url: 'https://example.com/reference.mp3',
        is_instrumental: true,
      }),
    ).rejects.toThrow('is_instrumental is only supported by music generation models');
  });

  it('throws on invalid output_format', async () => {
    await expect(
      sdk.generate({
        prompt: 'Folk',
        lyrics: 'no lyrics',
        output_format: 'mp3' as MusicGenerateRequest['output_format'],
      }),
    ).rejects.toThrow('Invalid output format');
  });

  it('throws when stream and output_format=url are used together', async () => {
    await expect(
      sdk.generate({ prompt: 'Folk', lyrics: 'no lyrics', stream: true, output_format: 'url' }),
    ).rejects.toThrow('stream and output_format url cannot be used together');
  });
});
