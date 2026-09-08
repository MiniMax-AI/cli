import { afterEach, describe, expect, it } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
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

  it('aborts while response headers are stalled and does not retry an external cancellation', async () => {
    const dir = makeTempDir();
    const destPath = join(dir, 'video.mp4');
    writeFileSync(destPath, 'original');
    const controller = new AbortController();
    let calls = 0;
    let fetchSignal: AbortSignal | undefined;

    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls++;
      fetchSignal = init?.signal ?? undefined;
      return await new Promise<Response>(() => {});
    }) as unknown as typeof fetch;

    const pending = downloadFile('https://example.com/video.mp4', destPath, {
      quiet: true,
      retries: 3,
      idleTimeoutMs: 1000,
      overallTimeoutMs: 1000,
      signal: controller.signal,
    });
    controller.abort(new Error('cancelled by caller'));

    await expect(pending).rejects.toThrow('cancelled by caller');
    expect(calls).toBe(1);
    expect(fetchSignal?.aborted).toBe(true);
    expect(readFileSync(destPath, 'utf-8')).toBe('original');
    expect(readdirSync(dir)).toEqual(['video.mp4']);
  });

  it('times out while waiting for response headers', async () => {
    const dir = makeTempDir();
    const destPath = join(dir, 'video.mp4');

    globalThis.fetch = (async () => await new Promise<Response>(() => {})) as unknown as typeof fetch;

    await expect(downloadFile('https://example.com/video.mp4', destPath, {
      quiet: true,
      retries: 0,
      idleTimeoutMs: 10,
      overallTimeoutMs: 1000,
    })).rejects.toThrow('idle timeout');

    expect(readdirSync(dir)).toEqual([]);
  });

  it('enforces the overall timeout even when the idle timeout is longer', async () => {
    const dir = makeTempDir();
    const destPath = join(dir, 'video.mp4');
    let fetchSignal: AbortSignal | undefined;

    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      fetchSignal = init?.signal ?? undefined;
      return await new Promise<Response>(() => {});
    }) as unknown as typeof fetch;

    await expect(downloadFile('https://example.com/video.mp4', destPath, {
      quiet: true,
      retries: 3,
      idleTimeoutMs: 1000,
      overallTimeoutMs: 10,
    })).rejects.toThrow('Download timed out after 10ms');

    expect(fetchSignal?.aborted).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('times out and cancels a body that stops producing data', async () => {
    const dir = makeTempDir();
    const destPath = join(dir, 'video.mp4');
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        // Keep the body open without producing data.
      },
      cancel() {
        cancelled = true;
      },
    });

    globalThis.fetch = (async () => new Response(stream, { status: 200 })) as unknown as typeof fetch;

    await expect(downloadFile('https://example.com/video.mp4', destPath, {
      quiet: true,
      retries: 0,
      idleTimeoutMs: 10,
      overallTimeoutMs: 1000,
    })).rejects.toThrow('idle timeout');

    expect(cancelled).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('rejects an oversized Content-Length before reading the body', async () => {
    const dir = makeTempDir();
    const destPath = join(dir, 'video.mp4');
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });

    globalThis.fetch = (async () => new Response(stream, {
      status: 200,
      headers: { 'content-length': '11' },
    })) as unknown as typeof fetch;

    await expect(downloadFile('https://example.com/video.mp4', destPath, {
      quiet: true,
      retries: 0,
      maxBytes: 10,
    })).rejects.toThrow('exceeds maximum size');

    expect(cancelled).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('enforces the byte limit while streaming when Content-Length is absent', async () => {
    const dir = makeTempDir();
    const destPath = join(dir, 'video.mp4');
    writeFileSync(destPath, 'original');

    globalThis.fetch = (async () => new Response(new Uint8Array(11), {
      status: 200,
    })) as unknown as typeof fetch;

    await expect(downloadFile('https://example.com/video.mp4', destPath, {
      quiet: true,
      retries: 0,
      maxBytes: 10,
    })).rejects.toThrow('exceeds maximum size');

    expect(readFileSync(destPath, 'utf-8')).toBe('original');
    expect(readdirSync(dir)).toEqual(['video.mp4']);
  });

  it('does not retry a permanent HTTP error or wrap its status', async () => {
    const dir = makeTempDir();
    const destPath = join(dir, 'video.mp4');
    let calls = 0;

    globalThis.fetch = (async () => {
      calls++;
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;

    await expect(downloadFile('https://example.com/missing', destPath, {
      quiet: true,
      retries: 3,
      retryDelayMs: 0,
    })).rejects.toThrow('Download failed: HTTP 404');

    expect(calls).toBe(1);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('retries HTTP 429 and respects a zero Retry-After value', async () => {
    const dir = makeTempDir();
    const destPath = join(dir, 'video.mp4');
    let calls = 0;

    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) {
        return new Response(null, { status: 429, headers: { 'retry-after': '0' } });
      }
      return new Response(new TextEncoder().encode('ok'), {
        status: 200,
        headers: { 'content-length': '2' },
      });
    }) as unknown as typeof fetch;

    await expect(downloadFile('https://example.com/video.mp4', destPath, {
      quiet: true,
      retries: 1,
      retryDelayMs: 0,
    })).resolves.toEqual({ size: 2 });

    expect(calls).toBe(2);
    expect(readFileSync(destPath, 'utf-8')).toBe('ok');
  });

  it('retries a 5xx response and succeeds on the next attempt', async () => {
    const dir = makeTempDir();
    const destPath = join(dir, 'video.mp4');
    let calls = 0;

    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) return new Response(null, { status: 503 });
      return new Response(new TextEncoder().encode('ok'), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(downloadFile('https://example.com/video.mp4', destPath, {
      quiet: true,
      retries: 1,
      retryDelayMs: 0,
    })).resolves.toEqual({ size: 2 });

    expect(calls).toBe(2);
  });

  it('preserves the destination and leaves no temp file after a writer error', async () => {
    const dir = makeTempDir();
    const outputDir = join(dir, 'readonly');
    mkdirSync(outputDir);
    const destPath = join(outputDir, 'video.mp4');
    writeFileSync(destPath, 'original');

    globalThis.fetch = (async () => new Response(new TextEncoder().encode('new'), {
      status: 200,
      headers: { 'content-length': '3' },
    })) as unknown as typeof fetch;

    chmodSync(outputDir, 0o555);
    try {
      await expect(downloadFile('https://example.com/video.mp4', destPath, {
        quiet: true,
        retries: 3,
      })).rejects.toThrow('Could not write download');
    } finally {
      chmodSync(outputDir, 0o755);
    }

    expect(readFileSync(destPath, 'utf-8')).toBe('original');
    expect(readdirSync(outputDir)).toEqual(['video.mp4']);
  });
});
