import { describe, it, expect, afterEach } from 'bun:test';
import { createMockServer, jsonResponse, sseResponse, type MockServer } from '../helpers/mock-server';
import { MiniMaxSDK } from '../../src/sdk';
import { SpeechSDK } from '../../src/sdk/speech';
import { existsSync, mkdtempSync, rmSync, truncateSync, unlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SpeechResponse, SpeechToTextFormat, SpeechToTextStreamEvent } from '../../src/types/api';
import { STT_MAX_FILE_BYTES } from '../../src/utils/stt';
import { withStubbedFetch } from '../helpers/fetch-stub';
import { SDKError } from '../../src/errors/base';

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
        () => jsonResponse({ text: 'transcribed', duration: 2.5 }),
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
      () => jsonResponse({ text: 'blob input', duration: 1 }),
      async (sent) => {
        const result = await sdk.transcribe({ file: new Blob(['blob audio']) });

        expect((sent.init?.body as FormData).get('file')).toBeInstanceOf(Blob);
        expect(result.text).toBe('blob input');
      },
    );
  });

  it('returns the subtitle document for srt, which the API sends as text', async () => {
    const { filePath, cleanup } = withTempAudio('srt audio');
    const srt = '1\n00:00:00,080 --> 00:00:04,540\nhello\n\n';

    try {
      await withStubbedFetch(
        () => new Response(srt, { status: 200, headers: { 'Content-Type': 'text/plain' } }),
        async (sent) => {
          const document = await sdk.transcribe({ file: filePath, response_format: 'srt' });

          expect((sent.init?.body as FormData).get('response_format')).toBe('srt');
          expect(document).toBe(srt);
        },
      );
    } finally {
      cleanup();
    }
  });

  it('rejects audio above the documented 50 MB limit', async () => {
    const { filePath, cleanup } = withTempAudio('oversized audio');

    try {
      truncateSync(filePath, STT_MAX_FILE_BYTES + 1);
      await expect(sdk.transcribe({ file: filePath })).rejects.toThrow(/at most 50 MB/);
    } finally {
      cleanup();
    }
  });

  it('yields streamed events when stream is enabled', async () => {
    const { filePath, cleanup } = withTempAudio('streamed audio');
    const response = sseResponse([
      { data: '{"index":0,"delta":"a","finish":false}' },
      { data: '{"index":1,"delta":"","finish":true,"duration":9.5}' },
    ]);

    try {
      await withStubbedFetch(
        () => response,
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

  it('stops the stream at the final event, not at the end of the body', async () => {
    const { filePath, cleanup } = withTempAudio('streamed audio');
    // An event after `finish` (and the helper's trailing [DONE]) must never
    // reach the consumer: the API terminates the stream at finish=true.
    const response = sseResponse([
      { data: '{"index":0,"delta":"done","finish":false}' },
      { data: '{"index":1,"delta":"","finish":true,"duration":3.25}' },
      { data: '{"index":2,"delta":"past the end","finish":false}' },
    ]);

    try {
      await withStubbedFetch(
        () => response,
        async () => {
          const events: SpeechToTextStreamEvent[] = [];
          for await (const event of await sdk.transcribe({ file: filePath, stream: true })) {
            events.push(event);
          }

          expect(events).toHaveLength(2);
          expect(events.at(-1)!.finish).toBe(true);
        },
      );
    } finally {
      cleanup();
    }
  });

  it('releases the SSE body when the consumer breaks out early', async () => {
    const { filePath, cleanup } = withTempAudio('streamed audio');
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          'data: {"index":0,"delta":"first","finish":false}\n\n' +
          'data: {"index":1,"delta":"","finish":true,"duration":1}\n\n',
        ));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(body, {
      headers: { 'Content-Type': 'text/event-stream' },
    });

    try {
      await withStubbedFetch(
        () => response,
        async () => {
          const seen: SpeechToTextStreamEvent[] = [];
          for await (const event of await sdk.transcribe({ file: filePath, stream: true })) {
            seen.push(event);
            break; // consumer stops after the first event
          }
          expect(seen).toHaveLength(1);
          await new Promise((resolve) => setTimeout(resolve, 0));
          expect(cancelled).toBe(true);
        },
      );
    } finally {
      cleanup();
    }
  });

  it('raises SDKError, not CLIError, for an invalid response format', async () => {
    const { filePath, cleanup } = withTempAudio('audio');

    try {
      try {
        await sdk.transcribe({ file: filePath, response_format: 'txt' as SpeechToTextFormat });
        throw new Error('Expected transcribe to reject');
      } catch (error) {
        expect(error).toBeInstanceOf(SDKError);
        expect((error as Error).message).toContain('Invalid response format "txt"');
      }
    } finally {
      cleanup();
    }
  });

  it('raises SDKError when stream is combined with a subtitle format', async () => {
    const { filePath, cleanup } = withTempAudio('audio');

    try {
      try {
        await sdk.transcribe({ file: filePath, stream: true, response_format: 'srt' });
        throw new Error('Expected transcribe to reject');
      } catch (error) {
        expect(error).toBeInstanceOf(SDKError);
        expect((error as Error).message).toContain('cannot be combined with stream=true');
      }
    } finally {
      cleanup();
    }
  });

  it('raises SDKError for audio above the 50 MB limit', async () => {
    const { filePath, cleanup } = withTempAudio('oversized');
    truncateSync(filePath, STT_MAX_FILE_BYTES + 1);

    try {
      try {
        await sdk.transcribe({ file: filePath });
        throw new Error('Expected transcribe to reject');
      } catch (error) {
        expect(error).toBeInstanceOf(SDKError);
        expect((error as Error).message).toContain('at most 50 MB');
      }
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

  it('rejects an unknown response format before uploading', async () => {
    const { filePath, cleanup } = withTempAudio('audio');
    const unknown = 'txt' as unknown as SpeechToTextFormat;

    try {
      await expect(
        sdk.transcribe({ file: filePath, response_format: unknown }),
      ).rejects.toThrow(/Invalid response format "txt"/);
    } finally {
      cleanup();
    }
  });
});
