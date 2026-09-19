import { describe, it, expect, afterEach } from 'bun:test';
import { createMockServer, jsonResponse, type MockServer } from '../helpers/mock-server';
import { MiniMaxSDK } from '../../src/sdk';
import { SpeechSDK } from '../../src/sdk/speech';
import { existsSync, mkdtempSync, rmSync, unlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SpeechResponse, SpeechToTextStreamEvent } from '../../src/types/api';

function makeSpeechResponse(hexAudio?: string): SpeechResponse {
  return {
    base_resp: { status_code: 0, status_msg: 'ok' },
    data: {
      audio: hexAudio || Buffer.from('hello speech audio').toString('hex'),
      status: 0,
    },
  };
}

describe('MiniMaxSDK.speech', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
  });

  it('should synthesize speech successfully', async () => {
    server = createMockServer({
      routes: {
        '/v1/t2a_v2': () => jsonResponse({
          data: { audio: 'base64audio' },
          base_resp: { status_code: 0, status_msg: 'success' },
        }),
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });

    const result = await sdk.speech.synthesize({
      text: 'Hello world',
    });

    expect(result.data.audio).toBe('base64audio');
  });

  it('should get voices list', async () => {
    server = createMockServer({
      routes: {
        '/v1/get_voice': () => jsonResponse({
          system_voice: [
            { voice_id: 'voice-1', voice_name: 'Voice 1', description: [] },
          ],
          base_resp: { status_code: 0, status_msg: 'success' },
        }),
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });

    const voices = await sdk.speech.voices();

    expect(voices).toHaveLength(1);
    expect(voices[0].voice_id).toBe('voice-1');
  });
});

describe('SpeechSDK.save', () => {
  const sdk = new SpeechSDK({ apiKey: 'sk-test', region: 'global' });

  it('decodes hex audio and saves to disk', () => {
    const out = join(tmpdir(), `speech-sdk-save-${Date.now()}.mp3`);
    const response = makeSpeechResponse();

    const saved = sdk.save(response, out);
    expect(saved).toBe(out);
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out).toString()).toBe('hello speech audio');
    unlinkSync(out);
  });

  it('generates default filename with timestamp', () => {
    const response = makeSpeechResponse();
    const saved = sdk.save(response);
    expect(saved).toMatch(/speech_\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.mp3/);
    expect(existsSync(saved)).toBe(true);
    unlinkSync(saved);
  });

  it('creates intermediate directories', () => {
    const out = join(tmpdir(), `speech-sdk-deep-${Date.now()}`, 'a', 'b', 'out.wav');
    const response = makeSpeechResponse();
    const saved = sdk.save(response, out, 'wav');
    expect(existsSync(saved)).toBe(true);
    unlinkSync(saved);
  });

  it('throws when audio data is missing', () => {
    const response = makeSpeechResponse('');
    response.data.audio = undefined;
    expect(() => sdk.save(response, '/tmp/test.mp3')).toThrow('missing audio data');
  });
});

describe('SpeechSDK.validateParams', () => {
  const sdk = new SpeechSDK({ apiKey: 'sk-test', region: 'global' });

  it('throws when text is missing', async () => {
    await expect(sdk.synthesize({} as any)).rejects.toThrow('text is required');
  });

  it('throws when text is empty string', async () => {
    await expect(sdk.synthesize({ text: '' })).rejects.toThrow('text is required');
  });
});

describe('SpeechSDK.transcribe', () => {
  const sdk = new SpeechSDK({ apiKey: 'sk-test', baseUrl: 'https://api.mmx.io' });

  async function withStubbedFetch(
    respond: () => Response,
    fn: (sent: { url: string; init: RequestInit | undefined }) => Promise<void>,
  ): Promise<void> {
    const originalFetch = globalThis.fetch;
    const sent = { url: '', init: undefined as RequestInit | undefined };
    globalThis.fetch = (async (input, init) => {
      sent.url = String(input);
      sent.init = init;
      return respond();
    }) as typeof fetch;

    try {
      await fn(sent);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  function withTempAudio(contents: string): { filePath: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), 'mmx-asr-sdk-'));
    const filePath = join(dir, 'clip.mp3');
    writeFileSync(filePath, contents);
    return { filePath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  it('uploads the audio as multipart and returns the transcript', async () => {
    const { filePath, cleanup } = withTempAudio('sdk audio');

    try {
      await withStubbedFetch(
        () => new Response(JSON.stringify({ text: 'transcribed', duration: 2.5 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
        async (sent) => {
          const result = await sdk.transcribe({ file: filePath, language: 'zh' });

          expect(sent.url).toBe('https://api.mmx.io/v1/speech_to_text');
          expect(sent.init?.method).toBe('POST');
          expect(sent.init?.headers).toMatchObject({ language: 'zh' });

          const body = sent.init?.body as FormData;
          expect(body.get('model')).toBe('asr-1.0');
          expect(body.get('response_format')).toBe('json');
          expect(body.get('language')).toBeNull();

          const uploaded = body.get('file');
          expect((uploaded as File).name).toBe('clip.mp3');
          expect(await (uploaded as Blob).text()).toBe('sdk audio');

          expect(result.text).toBe('transcribed');
          expect(result.duration).toBe(2.5);
        },
      );
    } finally {
      cleanup();
    }
  });

  it('accepts a Blob instead of a path', async () => {
    await withStubbedFetch(
      () => new Response(JSON.stringify({ text: 'blob input', duration: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
      async (sent) => {
        const result = await sdk.transcribe({ file: new Blob(['blob audio']) });

        expect((sent.init?.body as FormData).get('file')).toBeInstanceOf(Blob);
        expect(result.text).toBe('blob input');
      },
    );
  });

  it('yields streamed events when stream is enabled', async () => {
    const { filePath, cleanup } = withTempAudio('streamed audio');
    const sse = [
      'data: {"index":0,"delta":"a","finish":false}',
      '',
      'data: {"index":1,"delta":"","finish":true,"duration":9.5}',
      '',
      '',
    ].join('\n');

    try {
      await withStubbedFetch(
        () => new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
        async (sent) => {
          const events: SpeechToTextStreamEvent[] = [];
          for await (const event of await sdk.transcribe({ file: filePath, stream: true })) {
            events.push(event);
          }

          expect((sent.init?.body as FormData).get('stream')).toBe('true');
          expect(events).toHaveLength(2);
          expect(events[0]!.delta).toBe('a');
          expect(events[1]!.duration).toBe(9.5);
        },
      );
    } finally {
      cleanup();
    }
  });

  it('throws when file is missing', async () => {
    await expect(sdk.transcribe({ file: '' })).rejects.toThrow('file is required');
  });

  it('throws when the file does not exist', async () => {
    await expect(
      sdk.transcribe({ file: '/tmp/does-not-exist-xxxxx.mp3' }),
    ).rejects.toThrow('File not found');
  });

  it('throws when stream is combined with a non-json response format', async () => {
    const { filePath, cleanup } = withTempAudio('audio');

    try {
      await expect(
        sdk.transcribe({ file: filePath, stream: true, response_format: 'srt' }),
      ).rejects.toThrow(/cannot be combined with stream=true/);
    } finally {
      cleanup();
    }
  });
});
