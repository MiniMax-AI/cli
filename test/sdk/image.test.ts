import { describe, it, expect, afterEach } from 'bun:test';
import { createMockServer, jsonResponse, type MockServer } from '../helpers/mock-server';
import { MiniMaxSDK } from '../../src/sdk';
import { ImageSDK } from '../../src/sdk/image';
import { existsSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ImageResponse } from '../../src/types/api';

function makeBase64Response(images: string[]): ImageResponse {
  return {
    base_resp: { status_code: 0, status_msg: 'ok' },
    data: {
      image_base64: images,
      task_id: 'task-456',
      success_count: images.length,
      failed_count: 0,
    },
  };
}

function makeUrlResponse(urls: string[]): ImageResponse {
  return {
    base_resp: { status_code: 0, status_msg: 'ok' },
    data: {
      image_urls: urls,
      task_id: 'task-123',
      success_count: urls.length,
      failed_count: 0,
    },
  };
}

describe('MiniMaxSDK.image', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
  });

  it('should generate image successfully', async () => {
    server = createMockServer({
      routes: {
        '/v1/image_generation': () => jsonResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          data: {
            task_id: 'img-123',
            success_count: 1,
            failed_count: 0,
          },
        }),
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });

    const result = await sdk.image.generate({
      prompt: 'A beautiful sunset',
      width: 1024,
      height: 1024,
    });

    expect(result.data.task_id).toBe('img-123');
  });
});

describe('ImageSDK.save', () => {
  const sdk = new ImageSDK({ apiKey: 'sk-test', region: 'global' });

  it('saves a single base64 image with `out` option', async () => {
    const tmpFile = join(tmpdir(), `mmx-sdk-save-${Date.now()}.jpg`);
    const response = makeBase64Response(['/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA==']);

    const saved = await sdk.save(response, { out: tmpFile, responseFormat: 'base64' });

    expect(saved).toEqual([tmpFile]);
    expect(existsSync(tmpFile)).toBe(true);
    unlinkSync(tmpFile);
  });

  it('saves multiple base64 images to a directory', async () => {
    const tmpDir = join(tmpdir(), `mmx-sdk-imgs-${Date.now()}`);
    const response = makeBase64Response([
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA==',
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA==',
    ]);

    const saved = await sdk.save(response, {
      outDir: tmpDir,
      prefix: 'test',
      responseFormat: 'base64',
    });

    expect(saved.length).toBe(2);
    expect(saved[0]).toContain('test_001.jpg');
    expect(saved[1]).toContain('test_002.jpg');
    saved.forEach(p => expect(existsSync(p)).toBe(true));
    saved.forEach(p => unlinkSync(p));
    rmdirSync(tmpDir);
  });

  it('throws when `out` is used with multiple images', async () => {
    const response = makeUrlResponse([
      'https://example.com/img1.jpg',
      'https://example.com/img2.jpg',
    ]);
    await expect(
      sdk.save(response, { out: '/tmp/single.jpg', responseFormat: 'url' }),
    ).rejects.toThrow('Cannot use `out` with multiple images');
  });

  it('uses current directory by default', async () => {
    const response = makeBase64Response(['/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA==']);
    const saved = await sdk.save(response, { responseFormat: 'base64' });
    expect(saved.length).toBe(1);
    expect(saved[0]).toContain('image_001.jpg');
    expect(existsSync(saved[0]!)).toBe(true);
    unlinkSync(saved[0]!);
  });
});

describe('ImageSDK.validateParams', () => {
  const sdk = new ImageSDK({ apiKey: 'sk-test', region: 'global' });

  it('throws when width is provided without height', async () => {
    await expect(sdk.generate({ prompt: 'test', width: 1024 })).rejects.toThrow('Both width and height must be provided');
  });

  it('throws when height is provided without width', async () => {
    await expect(sdk.generate({ prompt: 'test', height: 1024 })).rejects.toThrow('Both width and height must be provided');
  });

  it('throws when width is below 512', async () => {
    await expect(sdk.generate({ prompt: 'test', width: 256, height: 256 })).rejects.toThrow('must be between 512 and 2048');
  });

  it('throws when height is above 2048', async () => {
    await expect(sdk.generate({ prompt: 'test', width: 1024, height: 4096 })).rejects.toThrow('must be between 512 and 2048');
  });

  it('throws when dimensions are not multiples of 8', async () => {
    await expect(sdk.generate({ prompt: 'test', width: 1025, height: 1024 })).rejects.toThrow('must be a multiple of 8');
  });

  it('accepts valid dimensions (passes validation, fails on network)', async () => {
    await expect(
      sdk.generate({ prompt: 'test', width: 1024, height: 1024 }),
    ).rejects.not.toThrow(/width|height/);
  });
});

describe('MiniMaxSDK.image (MiniMax-H3-Image)', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
  });

  it('routes to /v1/images/generations without images', async () => {
    let path = '';
    let body: Record<string, unknown> = {};
    server = createMockServer({
      routes: {
        '/v1/images/': async (req) => {
          path = new URL(req.url).pathname;
          body = await req.json() as Record<string, unknown>;
          return jsonResponse({ output_format: 'jpeg', data: [{ url: 'https://cdn/x.jpg', size: '2048x2048' }], request_id: 'r1' });
        },
      },
    });
    const sdk = new MiniMaxSDK({ apiKey: 'test-key', baseUrl: server.url });
    const result = await sdk.image.generate({ model: 'MiniMax-H3-Image', prompt: 'cat', aspect_ratio: '16:9', area: '2K' });
    expect(path).toBe('/v1/images/generations');
    expect(body).toEqual({ model: 'MiniMax-H3-Image', prompt: 'cat', aspect_ratio: '16:9', area: '2K' });
    expect(result.data[0]!.url).toBe('https://cdn/x.jpg');
    expect(result.request_id).toBe('r1');
  });

  it('routes to /v1/images/edits with images', async () => {
    let path = '';
    server = createMockServer({
      routes: {
        '/v1/images/': (req) => {
          path = new URL(req.url).pathname;
          return jsonResponse({ data: [{ b64_json: 'AA==' }] });
        },
      },
    });
    const sdk = new MiniMaxSDK({ apiKey: 'test-key', baseUrl: server.url });
    await sdk.image.generate({
      model: 'MiniMax-H3-Image',
      prompt: 'swap',
      images: [{ image_url: 'https://a/cat.jpg' }],
    });
    expect(path).toBe('/v1/images/edits');
  });

  it('validates H3 requests before sending', async () => {
    const sdk = new ImageSDK({ apiKey: 'sk-test', region: 'global' });
    await expect(sdk.generate({ model: 'MiniMax-H3-Image', prompt: 'x', n: 11 })).rejects.toThrow('1 to 10');
    await expect(sdk.generate({ model: 'MiniMax-H3-Image', prompt: 'x', size: '2048x2048', area: '2K' }))
      .rejects.toThrow('cannot be combined');
    // An empty images list is an edit request with no images, not a silent text-to-image call.
    await expect(sdk.generate({ model: 'MiniMax-H3-Image', prompt: 'x', images: [] }))
      .rejects.toThrow('1 to 16');
  });

  it('saves H3 responses with the returned output format', async () => {
    const sdk = new ImageSDK({ apiKey: 'sk-test', region: 'global' });
    const dir = join(tmpdir(), `mmx-sdk-h3-${Date.now()}`);
    const saved = await sdk.save({
      output_format: 'png',
      data: [{ error: { code: '1000' } }, { b64_json: 'AA==' }],
    }, { outDir: dir });
    expect(saved).toEqual([join(dir, 'image_002.png')]);
    expect(existsSync(saved[0]!)).toBe(true);
    unlinkSync(saved[0]!);
    rmdirSync(dir);
  });
});
