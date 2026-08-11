import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { downloadFile } from '../../src/files/download';

const originalFetch = globalThis.fetch;
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mmx-download-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('downloadFile', () => {
  it('keeps an existing destination intact when the download stream fails', async () => {
    const dir = makeTempDir();
    const destPath = join(dir, 'video.mp4');
    writeFileSync(destPath, 'original');

    globalThis.fetch = (async () => {
      let sentChunk = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sentChunk) {
            sentChunk = true;
            controller.enqueue(new TextEncoder().encode('partial'));
            return;
          }
          controller.error(new Error('stream failed'));
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { 'content-length': '100' },
      });
    }) as unknown as typeof fetch;

    await expect(
      downloadFile('https://example.com/video.mp4', destPath, { quiet: true, retries: 0 }),
    ).rejects.toThrow('Download failed');

    expect(readFileSync(destPath, 'utf-8')).toBe('original');
    expect(readdirSync(dir)).toEqual(['video.mp4']);
  });

  it('replaces the destination only after a successful download', async () => {
    const dir = makeTempDir();
    const destPath = join(dir, 'video.mp4');
    writeFileSync(destPath, 'original');

    globalThis.fetch = (async () => new Response(new TextEncoder().encode('new'), {
      status: 200,
      headers: { 'content-length': '3' },
    })) as unknown as typeof fetch;

    await expect(
      downloadFile('https://example.com/video.mp4', destPath, { quiet: true, retries: 0 }),
    ).resolves.toEqual({ size: 3 });

    expect(readFileSync(destPath, 'utf-8')).toBe('new');
    expect(existsSync(destPath)).toBe(true);
    expect(readdirSync(dir)).toEqual(['video.mp4']);
  });

  it('rejects a cleanly ended response whose body is shorter than Content-Length', async () => {
    const dir = makeTempDir();
    const destPath = join(dir, 'video.mp4');
    writeFileSync(destPath, 'original');

    globalThis.fetch = (async () => new Response(new TextEncoder().encode('new'), {
      status: 200,
      headers: { 'content-length': '10' },
    })) as unknown as typeof fetch;

    await expect(
      downloadFile('https://example.com/video.mp4', destPath, { quiet: true, retries: 0 }),
    ).rejects.toThrow('Download truncated: expected 10 bytes, received 3');

    expect(readFileSync(destPath, 'utf-8')).toBe('original');
    expect(readdirSync(dir)).toEqual(['video.mp4']);
  });

  it('does not compare decoded response bytes with compressed Content-Length', async () => {
    const dir = makeTempDir();
    const destPath = join(dir, 'video.mp4');

    globalThis.fetch = (async () => new Response(new TextEncoder().encode('new'), {
      status: 200,
      headers: {
        'content-encoding': 'gzip',
        'content-length': '10',
      },
    })) as unknown as typeof fetch;

    await expect(
      downloadFile('https://example.com/video.mp4', destPath, { quiet: true, retries: 0 }),
    ).resolves.toEqual({ size: 3 });

    expect(readFileSync(destPath, 'utf-8')).toBe('new');
  });

  it('passes request headers to the download', async () => {
    const dir = makeTempDir();
    const destPath = join(dir, 'audio.mp3');
    const request = { authorization: null as string | null };

    globalThis.fetch = (async (_input, init) => {
      request.authorization = new Headers(init?.headers).get('Authorization');
      return new Response(new TextEncoder().encode('audio'), { status: 200 });
    }) as typeof fetch;

    await downloadFile('https://example.com/audio.mp3', destPath, {
      quiet: true,
      headers: { Authorization: 'Bearer test-key' },
    });

    expect(request.authorization).toBe('Bearer test-key');
  });
});
