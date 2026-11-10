import { describe, it, expect } from 'bun:test';
import { default as generateCommand } from '../../../src/commands/image/generate';
import { createMockServer, jsonResponse } from '../../helpers/mock-server';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const baseConfig = {
  apiKey: 'test-key',
  region: 'global' as const,
  baseUrl: 'https://api.mmx.io',
  output: 'text' as const,
  timeout: 10,
  verbose: false,
  quiet: false,
  noColor: true,
  yes: false,
  dryRun: false,
  nonInteractive: true,
  async: false,
};

const baseFlags = {
  quiet: false,
  verbose: false,
  noColor: true,
  yes: false,
  dryRun: false,
  help: false,
  nonInteractive: true,
  async: false,
};

describe('image generate command', () => {
  it('has correct name', () => {
    expect(generateCommand.name).toBe('image generate');
  });

  it('requires prompt', async () => {
    await expect(
      generateCommand.execute(baseConfig, baseFlags),
    ).rejects.toThrow('Missing required argument: --prompt');
  });

  it('throws when width is provided without height', async () => {
    await expect(
      generateCommand.execute(baseConfig, { ...baseFlags, prompt: 'test', width: 1024 }),
    ).rejects.toThrow('--width requires --height');
  });

  it('throws when height is provided without width', async () => {
    await expect(
      generateCommand.execute(baseConfig, { ...baseFlags, prompt: 'test', height: 1024 }),
    ).rejects.toThrow('--height requires --width');
  });

  it('throws when width is below 512', async () => {
    await expect(
      generateCommand.execute(baseConfig, { ...baseFlags, prompt: 'test', width: 256, height: 256 }),
    ).rejects.toThrow('must be between 512 and 2048');
  });

  it('throws when height is above 2048', async () => {
    await expect(
      generateCommand.execute(baseConfig, { ...baseFlags, prompt: 'test', width: 1024, height: 4096 }),
    ).rejects.toThrow('must be between 512 and 2048');
  });

  it('throws when dimensions are not multiples of 8', async () => {
    await expect(
      generateCommand.execute(baseConfig, { ...baseFlags, prompt: 'test', width: 1025, height: 1024 }),
    ).rejects.toThrow('must be a multiple of 8');
  });

  it('throws when --out is used with --n > 1', async () => {
    await expect(
      generateCommand.execute(baseConfig, { ...baseFlags, prompt: 'test', out: '/tmp/img.jpg', n: 3 }),
    ).rejects.toThrow('--out cannot be used with --n > 1');
  });

  it('builds correct request body in dry-run', async () => {
    let captured = '';
    const origLog = console.log;
    console.log = (msg: string) => { captured += msg; };
    try {
      await generateCommand.execute(
        { ...baseConfig, dryRun: true, output: 'json' as const },
        { ...baseFlags, dryRun: true, prompt: 'A cat', aspectRatio: '16:9', n: 2, seed: 42 },
      );
    } catch { /* dry-run may log or resolve */ }
    console.log = origLog;
    const parsed = JSON.parse(captured);
    expect(parsed.request.prompt).toBe('A cat');
    expect(parsed.request.n).toBe(2);
    expect(parsed.request.seed).toBe(42);
    expect(parsed.request.model).toBe('image-01');
  });
});

describe('image generate command (MiniMax-H3-Image)', () => {
  const h3Flags = { ...baseFlags, model: 'MiniMax-H3-Image' };

  async function captureDryRun(flags: Record<string, unknown>) {
    let captured = '';
    const origLog = console.log;
    console.log = (msg: string) => { captured += msg; };
    try {
      await generateCommand.execute(
        { ...baseConfig, dryRun: true, output: 'json' as const },
        { ...h3Flags, dryRun: true, ...flags },
      );
    } finally {
      console.log = origLog;
    }
    return JSON.parse(captured).request;
  }

  it('builds a text-to-image request', async () => {
    const req = await captureDryRun({ prompt: 'A cat', aspectRatio: '16:9', area: '2K', n: 2, outputFormat: 'png' });
    expect(req).toEqual({
      model: 'MiniMax-H3-Image', prompt: 'A cat', n: 2, aspect_ratio: '16:9', area: '2K', output_format: 'png',
    });
  });

  it('maps --width/--height to size and --no-prompt-enhance', async () => {
    const req = await captureDryRun({ prompt: 'A cat', width: 2720, height: 1536, noPromptEnhance: true });
    expect(req.size).toBe('2720x1536');
    expect(req.disable_prompt_enhanced).toBe(true);
  });

  it('builds an edit request from --image', async () => {
    const req = await captureDryRun({ prompt: 'swap', image: ['https://a/cat.jpg', 'mm_file://7'], responseFormat: 'base64' });
    expect(req.images).toEqual([{ image_url: 'https://a/cat.jpg' }, { image_url: 'mm_file://7' }]);
    expect(req.response_format).toBe('b64_json');
    expect(req.disable_prompt_enhanced).toBeUndefined();
  });

  it('rejects legacy-only flags', async () => {
    await expect(
      generateCommand.execute(baseConfig, { ...h3Flags, prompt: 'x', seed: 1, subjectRef: 'type=character,image=a.jpg' }),
    ).rejects.toThrow('--seed, --subject-ref are not supported by MiniMax-H3-Image');
  });

  it('rejects H3-only flags without --model MiniMax-H3-Image', async () => {
    await expect(
      generateCommand.execute(baseConfig, { ...baseFlags, prompt: 'x', size: '2048x2048' }),
    ).rejects.toThrow('--size requires --model MiniMax-H3-Image');
  });

  it('rejects --size together with --width/--height', async () => {
    await expect(
      generateCommand.execute(baseConfig, { ...h3Flags, prompt: 'x', size: '2048x2048', width: 2048, height: 2048 }),
    ).rejects.toThrow('either --size or --width/--height');
  });

  it('surfaces validation errors as usage errors', async () => {
    await expect(
      generateCommand.execute(baseConfig, { ...h3Flags, prompt: 'x', size: '4096x1024' }),
    ).rejects.toThrow('between 1:3 and 3:1');
  });

  it('calls /v1/images/generations and saves partial results', async () => {
    let path = '';
    let body: Record<string, unknown> = {};
    const server = createMockServer({
      routes: {
        '/v1/images/': async (req) => {
          path = new URL(req.url).pathname;
          body = await req.json() as Record<string, unknown>;
          return jsonResponse({
            created: 1,
            output_format: 'webp',
            request_id: 'req-1',
            data: [
              { b64_json: Buffer.from('img').toString('base64'), size: '2048x2048', revised_prompt: 'rp' },
              { error: { code: '1027', message: 'output image failed content safety check' } },
            ],
            usage: { generated_images: 1 },
          });
        },
      },
    });
    const dir = mkdtempSync(join(tmpdir(), 'mmx-h3-cmd-'));
    let captured = '';
    let stderr = '';
    const origLog = console.log;
    const origErr = process.stderr.write.bind(process.stderr);
    console.log = (msg: string) => { captured += msg; };
    process.stderr.write = ((chunk: string | Uint8Array) => { stderr += String(chunk); return true; }) as typeof process.stderr.write;
    try {
      await generateCommand.execute(
        { ...baseConfig, baseUrl: server.url, output: 'json' as const, quiet: true },
        { ...h3Flags, prompt: 'A cat', n: 2, responseFormat: 'base64', outputFormat: 'webp', outDir: dir },
      );
    } finally {
      console.log = origLog;
      process.stderr.write = origErr;
      server.close();
    }

    // Failures are reported on stderr even with --quiet.
    expect(stderr).toContain('image 2 failed (1027)');
    expect(path).toBe('/v1/images/generations');
    expect(body.n).toBe(2);
    const out = JSON.parse(captured);
    expect(out.id).toBe('req-1');
    expect(out.saved).toEqual([join(dir, 'image_001.webp')]);
    expect(out.success_count).toBe(1);
    expect(out.failed_count).toBe(1);
    expect(out.failures[0].code).toBe('1027');
    expect(out.revised_prompts).toEqual(['rp', null]);
    expect(readFileSync(join(dir, 'image_001.webp'), 'utf8')).toBe('img');
    rmSync(dir, { recursive: true });
  });

  it('calls /v1/images/edits when --image is given', async () => {
    let path = '';
    const server = createMockServer({
      routes: {
        '/v1/images/': (req) => {
          path = new URL(req.url).pathname;
          return jsonResponse({ output_format: 'jpeg', data: [{ b64_json: 'AA==' }] });
        },
      },
    });
    const dir = mkdtempSync(join(tmpdir(), 'mmx-h3-edit-'));
    const origLog = console.log;
    console.log = () => {};
    try {
      await generateCommand.execute(
        { ...baseConfig, baseUrl: server.url, quiet: true },
        { ...h3Flags, prompt: 'edit', image: ['https://a/cat.jpg'], responseFormat: 'b64_json', out: join(dir, 'x.jpg') },
      );
    } finally {
      console.log = origLog;
      server.close();
    }
    expect(path).toBe('/v1/images/edits');
    expect(existsSync(join(dir, 'x.jpg'))).toBe(true);
    rmSync(dir, { recursive: true });
  });
});
