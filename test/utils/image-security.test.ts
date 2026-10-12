import { afterEach, describe, expect, it } from 'bun:test';
import { toDataUri } from '../../src/utils/image';
import { CLIError } from '../../src/errors/base';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('image security and validation (SSRF and bounded buffering)', () => {
  it('rejects remote image URLs pointing to loopback addresses', async () => {
    await expect(toDataUri('http://127.0.0.1:8080/avatar.png')).rejects.toThrow(CLIError);
    await expect(toDataUri('http://127.0.0.1:8080/avatar.png')).rejects.toThrow(/SSRF protection/);
  });

  it('rejects remote image URLs pointing to localhost', async () => {
    await expect(toDataUri('http://localhost:3000/image.jpg')).rejects.toThrow(/SSRF protection/);
  });

  it('rejects remote image URLs pointing to AWS/cloud metadata (169.254.169.254)', async () => {
    await expect(toDataUri('http://169.254.169.254/secret.png')).rejects.toThrow(/SSRF protection/);
  });

  it('rejects remote image URLs pointing to private RFC 1918 addresses', async () => {
    await expect(toDataUri('http://10.0.0.5/test.png')).rejects.toThrow(/SSRF protection/);
    await expect(toDataUri('http://192.168.1.50/pic.jpg')).rejects.toThrow(/SSRF protection/);
  });

  it('rejects oversized image based on Content-Length before downloading full stream', async () => {
    globalThis.fetch = (async () => new Response('tiny-body', {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'content-length': String(51 * 1024 * 1024), // 51 MB
      },
    })) as unknown as typeof fetch;

    await expect(toDataUri('https://example.com/huge.png')).rejects.toThrow(/Image too large/);
  });

  it('aborts and rejects oversized response stream when Content-Length is missing or dishonest', async () => {
    let canceled = false;
    const chunk = new Uint8Array(10 * 1024 * 1024); // 10MB chunk
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
      },
      cancel() {
        canceled = true;
      },
    });

    globalThis.fetch = (async () => new Response(stream, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })) as unknown as typeof fetch;

    await expect(toDataUri('https://example.com/streaming-bomb.png')).rejects.toThrow(/Image too large/);
    expect(canceled).toBe(true);
  });

  it('successfully converts valid remote image stream to data URI', async () => {
    const imageData = new TextEncoder().encode('fake-image-bytes');
    globalThis.fetch = (async () => new Response(imageData, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })) as unknown as typeof fetch;

    const uri = await toDataUri('https://example.com/valid.png');
    expect(uri.startsWith('data:image/png;base64,')).toBe(true);
  });
});
