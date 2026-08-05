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
    await expect(sdk.upload('/tmp/nonexistent-file-xxxxx.bin', 'retrieval'))
      .rejects
      .toThrow('File not found');
  });

  it('gets past file existence check for a valid file', async () => {
    const tmpFile = join(tmpdir(), 'mmx-sdk-test-upload.txt');
    writeFileSync(tmpFile, 'hello world');

    try {
      const sdk = new FileSDK({ apiKey: 'sk-test', region: 'global' });
      await sdk.upload(tmpFile, 'retrieval');
      // Should not reach here (no mock server), but if it does, fail informatively
    } catch (err) {
      // Must NOT be "File not found" — proves file existence check passed
      expect((err as Error).message).not.toContain('File not found');
    } finally {
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
