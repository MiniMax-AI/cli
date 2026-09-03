import { describe, it, expect, afterEach } from 'bun:test';
import { createMockServer, jsonResponse, type MockServer } from '../helpers/mock-server';
import { MiniMaxSDK } from '../../src/sdk';
import { SpeechSDK } from '../../src/sdk/speech';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SpeechResponse } from '../../src/types/api';

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

  it('should clone a voice successfully', async () => {
    server = createMockServer({
      routes: {
        '/v1/voice_clone': async (req) => {
          const body = await req.json() as Record<string, unknown>;
          expect(body).toEqual({
            file_id: 123,
            voice_id: 'my_voice',
          });
          return jsonResponse({
            input_sensitive: false,
            input_sensitive_type: 0,
            demo_audio: '',
            extra_info: { audio_length: 1000 },
            base_resp: { status_code: 0, status_msg: 'success' },
          });
        },
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });

    const result = await sdk.speech.clone({
      file_id: 123,
      voice_id: 'my_voice',
    });

    expect(result.input_sensitive).toBe(false);
  });

  it('should design a voice successfully', async () => {
    server = createMockServer({
      routes: {
        '/v1/voice_design': async (req) => {
          const body = await req.json() as Record<string, unknown>;
          expect(body).toEqual({
            prompt: 'Warm and clear narrator',
            preview_text: 'Welcome to the show',
          });
          return jsonResponse({
            trial_audio: 'hex-audio',
            base_resp: { status_code: 0, status_msg: 'success' },
          });
        },
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });

    const result = await sdk.speech.design({
      prompt: 'Warm and clear narrator',
      preview_text: 'Welcome to the show',
    });

    expect(result.trial_audio).toBe('hex-audio');
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
