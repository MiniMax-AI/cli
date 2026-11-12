import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ImageSDK } from '../../src/sdk/image';
import type { ImageResponse } from '../../src/types/api';
import { withStubbedFetch } from '../helpers/fetch-stub';

const sdk = new ImageSDK({ apiKey: 'test-key', region: 'global' });

function response(format: 'url' | 'base64', images?: string[]): ImageResponse {
  return {
    base_resp: { status_code: 0, status_msg: 'ok' },
    data: {
      ...(format === 'url' ? { image_urls: images } : { image_base64: images }),
      task_id: 'empty-images',
      success_count: 0,
      failed_count: 1,
    },
  };
}

describe('ImageSDK.save with no image data', () => {
  for (const format of ['url', 'base64'] as const) {
    for (const images of [undefined, [], [''], [' \n\t ']]) {
      it(`does not report a saved path or create directories for ${format} ${JSON.stringify(images)}`, async () => {
        const dir = mkdtempSync(join(tmpdir(), 'mmx-image-empty-'));
        const out = join(dir, 'nested', 'image.jpg');
        try {
          expect(await sdk.save(response(format, images), { out, responseFormat: format })).toEqual([]);
          expect(existsSync(join(dir, 'nested'))).toBe(false);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });
    }

    it(`leaves an existing destination intact without reporting it as saved (${format})`, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'mmx-image-existing-'));
      const out = join(dir, 'image.jpg');
      try {
        writeFileSync(out, 'existing image');
        expect(await sdk.save(response(format, []), { out, responseFormat: format })).toEqual([]);
        expect(readFileSync(out, 'utf8')).toBe('existing image');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  it('still downloads a valid single URL image to the requested nested path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mmx-image-download-'));
    const out = join(dir, 'nested', 'image.jpg');
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    try {
      await withStubbedFetch(() => new Response(bytes), async (sent) => {
        expect(await sdk.save(response('url', ['https://example.com/image']), { out })).toEqual([out]);
        expect(sent.url).toBe('https://example.com/image');
      });
      expect(new Uint8Array(readFileSync(out))).toEqual(bytes);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
