import { describe, it, expect } from 'bun:test';
import { FileSDK } from '../../src/sdk/file';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('FileSDK', () => {
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
});
