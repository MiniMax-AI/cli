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
