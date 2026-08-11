import { describe, it, expect, afterEach } from 'bun:test';
import { createMockServer, jsonResponse, type MockServer } from '../helpers/mock-server';
import { MiniMaxSDK } from '../../src/sdk';
import type { SpeechAsyncRequest } from '../../src/types/api';

describe('MiniMaxSDK.speech.createAsync', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
  });

  it('creates an async TTS task and returns the task id', async () => {
    let requestBody: Record<string, unknown> | undefined;
    server = createMockServer({
      routes: {
        '/v1/t2a_async_v2': async (req) => {
          requestBody = await req.json() as Record<string, unknown>;
          return jsonResponse({
            task_id: 95157322514444,
            file_id: 95157322514444,
            usage_characters: 101,
            base_resp: { status_code: 0, status_msg: 'success' },
          });
        },
      },
    });

    const sdk = new MiniMaxSDK({ apiKey: 'test-key', baseUrl: server.url });
    const result = await sdk.speech.createAsync({
      model: 'speech-2.8-hd',
      text: 'Hello world',
    });

    expect(result.task_id).toBe(95157322514444);
    expect(requestBody?.model).toBe('speech-2.8-hd');
    expect(requestBody?.text).toBe('Hello world');
    expect((requestBody?.audio_setting as Record<string, unknown>).audio_sample_rate).toBe(32000);
    expect((requestBody?.audio_setting as Record<string, unknown>).sample_rate).toBeUndefined();
    expect(requestBody?.output_format).toBeUndefined();
  });

  it('accepts text_file_id for uploaded long text', async () => {
    let requestBody: Record<string, unknown> | undefined;
    server = createMockServer({
      routes: {
        '/v1/t2a_async_v2': async (req) => {
          requestBody = await req.json() as Record<string, unknown>;
          return jsonResponse({ task_id: 123, base_resp: { status_code: 0 } });
        },
      },
    });

    const sdk = new MiniMaxSDK({ apiKey: 'test-key', baseUrl: server.url });
    await sdk.speech.createAsync({ text_file_id: 'file-123' });

    expect(requestBody?.text_file_id).toBe('file-123');
    expect(requestBody?.text).toBeUndefined();
  });

  it('throws when text and text_file_id are missing', async () => {
    const sdk = new MiniMaxSDK({ apiKey: 'test-key', baseUrl: 'https://x' });
    await expect(sdk.speech.createAsync({} as SpeechAsyncRequest)).rejects.toThrow('text or text_file_id is required');
  });

  it('rejects direct text over 50,000 characters', async () => {
    const sdk = new MiniMaxSDK({ apiKey: 'test-key', baseUrl: 'https://x' });
    await expect(sdk.speech.createAsync({ text: 'x'.repeat(50_001) })).rejects.toThrow('text is limited to 50,000 characters');
  });
});

describe('MiniMaxSDK.speech.queryAsync', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
  });

  it('queries the async task status', async () => {
    const query = { method: '', body: undefined as Record<string, unknown> | undefined };
    server = createMockServer({
      routes: {
        '/v1/query/t2a_async_query_v2': async (req) => {
          query.method = req.method;
          query.body = await req.json() as Record<string, unknown>;
          return jsonResponse({
            task_id: 95157322514444,
            status: 'Processing',
            base_resp: { status_code: 0, status_msg: 'success' },
          });
        },
      },
    });

    const sdk = new MiniMaxSDK({ apiKey: 'test-key', baseUrl: server.url });
    const result = await sdk.speech.queryAsync('95157322514444');

    expect(result.task_id).toBe(95157322514444);
    expect(result.status).toBe('Processing');
    expect(query.method).toBe('POST');
    expect(query.body).toEqual({ task_id: '95157322514444' });
  });

  it('surfaces the file id when the task completes', async () => {
    server = createMockServer({
      routes: {
        '/v1/query/t2a_async_query_v2': () => jsonResponse({
          task_id: 95157322514444,
          status: 'Success',
          file_id: 95157322514496,
          base_resp: { status_code: 0, status_msg: 'success' },
        }),
      },
    });

    const sdk = new MiniMaxSDK({ apiKey: 'test-key', baseUrl: server.url });
    const result = await sdk.speech.queryAsync('95157322514444');

    expect(result.status).toBe('Success');
    expect(result.file_id).toBe(95157322514496);
  });
});

describe('MiniMaxSDK.speech.downloadAsyncFile', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
  });

  it('downloads the audio bytes to disk', async () => {
    server = createMockServer({
      routes: {
        '/v1/files/retrieve_content': (req) => {
          expect(req.headers.get('Authorization')).toBe('Bearer test-key');
          return new Response(
            Buffer.from('hello audio'),
            { headers: { 'Content-Type': 'application/octet-stream' } },
          );
        },
      },
    });

    const sdk = new MiniMaxSDK({ apiKey: 'test-key', baseUrl: server.url });
    const dest = await sdk.speech.downloadAsyncFile('95157322514496');

    expect(await import('node:fs').then(fs => fs.existsSync(dest))).toBe(true);
    const { readFileSync, unlinkSync } = await import('node:fs');
    expect(readFileSync(dest).toString()).toBe('hello audio');
    unlinkSync(dest);
  });
});
