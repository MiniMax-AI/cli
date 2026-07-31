import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { downloadFile } from '../../src/update/self-update';

const originalFetch = globalThis.fetch;
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mmx-self-update-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('self-update downloadFile', () => {
  it('cleans up the temp file when the response stream fails mid-download', async () => {
    // Regression for review feedback on PR #158: a network failure mid-stream
    // must leave NOTHING behind at `dest` — earlier versions of this path
    // left a partial binary in tmpdir after a 5xx mid-stream / TLS reset.
    const dir = makeTempDir();
    const destPath = join(dir, 'mmx-update');

    globalThis.fetch = (async () => {
      let sentChunk = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sentChunk) {
            sentChunk = true;
            controller.enqueue(new TextEncoder().encode('half-of-the-binary'));
            return;
          }
          controller.error(new Error('connection reset by peer'));
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-length': '1000' },
      });
    }) as unknown as typeof fetch;

    await expect(
      downloadFile('https://example.com/mmx-linux-amd64', destPath),
    ).rejects.toThrow('connection reset by peer');

    // The exact assertion the reviewer asked for: the partial file is gone,
    // i.e. cleanup runs AFTER the writer is torn down. The directory should
    // contain no leftover artefact at all.
    expect(existsSync(destPath)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('writes the full payload and waits for the writer to flush on success', async () => {
    // Pair-test: the happy path must still resolve with a fully-written file.
    // Catches a regression where the new error-path teardown accidentally
    // also runs on success and unlinks a valid binary.
    const dir = makeTempDir();
    const destPath = join(dir, 'mmx-update');
    const payload = new TextEncoder().encode('the-entire-binary-payload');

    globalThis.fetch = (async () => new Response(payload, {
      status: 200,
      headers: { 'content-length': String(payload.byteLength) },
    })) as unknown as typeof fetch;

    await expect(
      downloadFile('https://example.com/mmx-linux-amd64', destPath),
    ).resolves.toBeUndefined();

    expect(existsSync(destPath)).toBe(true);
    expect(readdirSync(dir)).toEqual(['mmx-update']);
  });

  it('rejects with a CLIError on non-2xx response without creating a file', async () => {
    const dir = makeTempDir();
    const destPath = join(dir, 'mmx-update');

    globalThis.fetch = (async () => new Response('not found', {
      status: 404,
      statusText: 'Not Found',
    })) as unknown as typeof fetch;

    await expect(
      downloadFile('https://example.com/missing', destPath),
    ).rejects.toThrow(/Download failed: 404/);

    expect(existsSync(destPath)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });
});
