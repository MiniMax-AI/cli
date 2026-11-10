import { describe, it, expect } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildImageH3Request,
  imageH3Extension,
  ImageH3InputError,
  isImageH3EditRequest,
  resolveImageH3Input,
  saveImageH3Images,
  validateImageH3Request,
} from '../../src/image/h3';
import type { ImageH3Request } from '../../src/types/api';

describe('b64_json total output area', () => {
  it('allows 4 x 4K jpeg but rejects 5 x 4K (auto size counts the area level)', () => {
    expect(() => buildImageH3Request({ prompt: 'x', responseFormat: 'b64_json', n: 4 })).not.toThrow();
    expect(() => buildImageH3Request({ prompt: 'x', responseFormat: 'b64_json', n: 5 })).toThrow('80,000,000');
  });

  it('allows 10 x 2K jpeg', () => {
    expect(() => buildImageH3Request({ prompt: 'x', responseFormat: 'b64_json', n: 10, area: '2K' })).not.toThrow();
  });

  it('uses the 20 MP png limit with explicit sizes', () => {
    expect(() => buildImageH3Request({ prompt: 'x', responseFormat: 'b64_json', outputFormat: 'png', size: '4096x4096' }))
      .not.toThrow();
    expect(() => buildImageH3Request({ prompt: 'x', responseFormat: 'b64_json', outputFormat: 'png', size: '4096x4096', n: 2 }))
      .toThrow('20,000,000');
  });

  it('does not limit url responses', () => {
    expect(() => buildImageH3Request({ prompt: 'x', n: 10 })).not.toThrow();
  });
});

describe('buildImageH3Request', () => {
  it('builds a text-to-image request and drops unset fields', () => {
    const req = buildImageH3Request({ prompt: 'cat', aspectRatio: '16:9', area: '2K', n: 2 });
    expect(req).toEqual({ model: 'MiniMax-H3-Image', prompt: 'cat', n: 2, aspect_ratio: '16:9', area: '2K' });
    expect(isImageH3EditRequest(req)).toBe(false);
  });

  it('builds an edit request when images are given', () => {
    const req = buildImageH3Request({ prompt: 'swap', images: ['https://a/1.jpg', 'mm_file://9'] });
    expect(isImageH3EditRequest(req)).toBe(true);
    expect((req as { images: unknown }).images).toEqual([
      { image_url: 'https://a/1.jpg' },
      { image_url: 'mm_file://9' },
    ]);
  });

  it('maps base64 to b64_json', () => {
    expect(buildImageH3Request({ prompt: 'x', responseFormat: 'base64' }).response_format).toBe('b64_json');
  });

  it('rejects disabling enhancement for edits', () => {
    expect(() => buildImageH3Request({ prompt: 'x', images: ['https://a/1.jpg'], disablePromptEnhanced: true }))
      .toThrow('always on for image edits');
  });
});

describe('validateImageH3Request', () => {
  const ok = (extra: Partial<ImageH3Request>) =>
    validateImageH3Request({ model: 'MiniMax-H3-Image', prompt: 'x', ...extra } as ImageH3Request);

  it('accepts documented sizes', () => {
    expect(() => ok({ size: '2720x1536' })).not.toThrow();
    expect(() => ok({ size: '7104x2368' })).not.toThrow();
    expect(() => ok({ size: 'auto', aspect_ratio: '21:9', area: '1K' })).not.toThrow();
  });

  it('rejects empty prompts and prompts over 32000 characters', () => {
    expect(() => ok({ prompt: '   ' })).toThrow('non-empty prompt');
    expect(() => ok({ prompt: '猫'.repeat(32001) })).toThrow('32000');
    expect(() => ok({ prompt: '猫'.repeat(32000) })).not.toThrow();
  });

  it('rejects n outside 1-10', () => {
    expect(() => ok({ n: 0 })).toThrow('1 to 10');
    expect(() => ok({ n: 11 })).toThrow('1 to 10');
    expect(() => ok({ n: 1.5 })).toThrow('1 to 10');
  });

  it('checks size area and ratio bounds', () => {
    expect(() => ok({ size: '800x800' })).toThrow('655,360');
    expect(() => ok({ size: '5000x5000' })).toThrow('20,000,000');
    expect(() => ok({ size: '4096x1024' })).toThrow('1:3 and 3:1');
    expect(() => ok({ size: '2720*1536' })).toThrow('WIDTHxHEIGHT');
  });

  it('rejects size WxH combined with aspect_ratio or area', () => {
    expect(() => ok({ size: '2720x1536', aspect_ratio: '16:9' })).toThrow('cannot be combined');
    expect(() => ok({ size: '2720x1536', area: '2K' })).toThrow('cannot be combined');
  });

  it('checks aspect ratio format and range', () => {
    expect(() => ok({ aspect_ratio: '16/9' })).toThrow('X:Y');
    expect(() => ok({ aspect_ratio: '301:300' })).toThrow('1 to 300');
    expect(() => ok({ aspect_ratio: '4:1' })).toThrow('1:3 and 3:1');
    expect(() => ok({ aspect_ratio: '3:1' })).not.toThrow();
  });

  it('checks enums and compression', () => {
    expect(() => ok({ area: '8K' as never })).toThrow('1K, 2K, 4K');
    expect(() => ok({ output_format: 'gif' as never })).toThrow('jpg, jpeg, png, webp');
    expect(() => ok({ output_compression: 101 })).toThrow('0 to 100');
    expect(() => ok({ response_format: 'base64' as never })).toThrow('url or b64_json');
  });

  it('requires a concrete size or ratio when enhancement is disabled', () => {
    expect(() => ok({ disable_prompt_enhanced: true })).toThrow('explicit size');
    expect(() => ok({ disable_prompt_enhanced: true, aspect_ratio: 'auto' })).toThrow('explicit size');
    expect(() => ok({ disable_prompt_enhanced: true, aspect_ratio: '1:1' })).not.toThrow();
    expect(() => ok({ disable_prompt_enhanced: true, size: '2048x2048' })).not.toThrow();
  });

  it('limits reference images to 1-16', () => {
    const images = (n: number) => Array.from({ length: n }, (_, i) => ({ image_url: `https://a/${i}.jpg` }));
    expect(() => ok({ images: images(16) } as never)).not.toThrow();
    expect(() => ok({ images: images(17) } as never)).toThrow('1 to 16');
    expect(() => ok({ images: [] } as never)).toThrow('1 to 16');
  });
});

describe('resolveImageH3Input', () => {
  it('passes remote references through', () => {
    for (const v of ['https://a/b.png', 'http://a/b.png', 'mm_file://1', 'data:image/png;base64,AA==']) {
      expect(resolveImageH3Input(v)).toBe(v);
    }
  });

  it('encodes local files and rejects missing or unsupported ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mmx-h3-in-'));
    const png = join(dir, 'a.png');
    writeFileSync(png, Buffer.from([1, 2, 3]));
    expect(resolveImageH3Input(png)).toBe('data:image/png;base64,AQID');
    const gif = join(dir, 'a.gif');
    writeFileSync(gif, 'x');
    expect(() => resolveImageH3Input(gif)).toThrow(ImageH3InputError);
    expect(() => resolveImageH3Input(join(dir, 'missing.jpg'))).toThrow('not found');
    rmSync(dir, { recursive: true });
  });
});

describe('saveImageH3Images', () => {
  it('maps output_format to extensions', () => {
    expect(imageH3Extension('jpeg')).toBe('jpg');
    expect(imageH3Extension('png')).toBe('png');
    expect(imageH3Extension('webp')).toBe('webp');
    expect(imageH3Extension(undefined)).toBe('jpg');
  });

  it('saves successes by position and reports failures', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mmx-h3-save-'));
    const result = await saveImageH3Images({
      output_format: 'png',
      data: [
        { b64_json: Buffer.from('one').toString('base64'), size: '2048x2048' },
        { error: { code: '1027', message: 'output image failed content safety check' } },
        { b64_json: Buffer.from('three').toString('base64') },
      ],
    }, { outDir: dir, prefix: 'h3' });

    expect(result.saved).toEqual([join(dir, 'h3_001.png'), join(dir, 'h3_003.png')]);
    expect(readFileSync(join(dir, 'h3_003.png'), 'utf8')).toBe('three');
    expect(existsSync(join(dir, 'h3_002.png'))).toBe(false);
    expect(result.failures).toEqual([
      { index: 1, code: '1027', message: 'output image failed content safety check' },
    ]);
    rmSync(dir, { recursive: true });
  });

  it('rejects out with more than one successful image', async () => {
    await expect(saveImageH3Images({
      data: [{ b64_json: 'AA==' }, { b64_json: 'AA==' }],
    }, { out: join(tmpdir(), 'x.jpg') })).rejects.toThrow('Cannot use `out` with multiple images');
  });
});
