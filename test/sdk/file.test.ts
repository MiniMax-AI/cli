import { describe, it, expect, afterEach } from 'bun:test';
import { FileSDK } from '../../src/sdk/file';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMockServer, jsonResponse, type MockServer } from '../helpers/mock-server';

describe('FileSDK', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
  });

  it('throws SDKError when file does not exist', async () => {
    const sdk = new FileSDK({ apiKey: 'sk-test', region: 'global' });
    try {
      await sdk.upload('/tmp/nonexistent-file-xxxxx.bin', 'retrieval');
      throw new Error('Expected upload to reject');
    } catch (error) {
      expect(error).toMatchObject({
        name: 'SDKError',
        message: expect.stringContaining('File not found'),
        exitCode: 2,
      });
    }
  });

  it('uploads through the shared multipart operation and returns the response', async () => {
    const tmpFile = join(tmpdir(), 'mmx-sdk-test-upload.txt');
    writeFileSync(tmpFile, 'hello world');
    const originalFetch = globalThis.fetch;
    let requestUrl = '';
    let requestInit: RequestInit | undefined;

    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({
        base_resp: { status_code: 0, status_msg: 'success' },
        file: {
          file_id: 'sdk-file-id',
          bytes: 11,
          created_at: 1,
          filename: 'mmx-sdk-test-upload.txt',
          purpose: 'retrieval',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const sdk = new FileSDK({ apiKey: 'sk-test', region: 'global' });
      const response = await sdk.upload(tmpFile, 'retrieval');

      expect(response.file.file_id).toBe('sdk-file-id');
      expect(requestUrl).toBe('https://api.minimax.io/v1/files/upload');
      expect(requestInit?.method).toBe('POST');
      expect(requestInit?.headers).toMatchObject({ Authorization: 'Bearer sk-test' });
      expect(requestInit?.body).toBeInstanceOf(FormData);

      const body = requestInit?.body as FormData;
      const uploadedFile = body.get('file');
      expect(uploadedFile).toBeInstanceOf(Blob);
      expect((uploadedFile as File).name).toBe('mmx-sdk-test-upload.txt');
      expect(await (uploadedFile as Blob).text()).toBe('hello world');
      expect(body.get('purpose')).toBe('retrieval');
    } finally {
      globalThis.fetch = originalFetch;
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    }
  });

  it('preserves a file ID above Number.MAX_SAFE_INTEGER', async () => {
    const fileId = '9223372036854775807';
    let body: Record<string, unknown> = {};
    server = createMockServer({
      routes: {
        '/v1/files/delete': async (req) => {
          body = await req.json() as Record<string, unknown>;
          return jsonResponse({
            base_resp: { status_code: 0, status_msg: '' },
            file_id: fileId,
          });
        },
      },
    });

    const sdk = new FileSDK({ apiKey: 'sk-test', baseUrl: server.url });
    const response = await sdk.delete(fileId);

    expect(body.file_id).toBe(fileId);
    expect(response.file_id).toBe(fileId);
  });

  it('accepts bigint IDs without losing precision', async () => {
    const fileId = 9_223_372_036_854_775_807n;
    let body: Record<string, unknown> = {};
    server = createMockServer({
      routes: {
        '/v1/files/delete': async (req) => {
          body = await req.json() as Record<string, unknown>;
          return jsonResponse({
            base_resp: { status_code: 0, status_msg: '' },
            file_id: fileId.toString(),
          });
        },
      },
    });

    const sdk = new FileSDK({ apiKey: 'sk-test', baseUrl: server.url });
    await sdk.delete(fileId);

    expect(body.file_id).toBe(fileId.toString());
  });

  it('rejects invalid and unsafe numeric IDs before making a request', async () => {
    const sdk = new FileSDK({ apiKey: 'sk-test', region: 'global' });

    await expect(sdk.delete('not-an-id')).rejects.toThrow(
      'fileId must be a positive decimal integer within the int64 range.',
    );
    await expect(sdk.delete(Number.MAX_SAFE_INTEGER + 1)).rejects.toThrow(
      'fileId must be a positive decimal integer within the int64 range.',
    );
    await expect(sdk.delete('9223372036854775808')).rejects.toThrow(
      'fileId must be a positive decimal integer within the int64 range.',
    );
  });
});
