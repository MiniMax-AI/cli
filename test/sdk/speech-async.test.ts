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
    expect(requestBody?.output_format).toBeUndefined();
  });

  it('throws when text is missing', async () => {
    const sdk = new MiniMaxSDK({ apiKey: 'test-key', baseUrl: 'https://x' });
    await expect(sdk.speech.createAsync({} as SpeechAsyncRequest)).rejects.toThrow('text is required');
  });
});

describe('MiniMaxSDK.speech.queryAsync', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
  });

  it('queries the async task status', async () => {
    server = createMockServer({
      routes: {
        '/v1/query/t2a_async_query_v2': () => jsonResponse({
          task_id: 95157322514444,
          status: 'Processing',
          base_resp: { status_code: 0, status_msg: 'success' },
        }),
      },
    });

    const sdk = new MiniMaxSDK({ apiKey: 'test-key', baseUrl: server.url });
    const result = await sdk.speech.queryAsync('95157322514444');

    expect(result.task_id).toBe(95157322514444);
    expect(result.status).toBe('Processing');
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
        '/v1/files/retrieve_content': () => new Response(
          Buffer.from('hello audio'),
          { headers: { 'Content-Type': 'application/octet-stream' } },
        ),
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
