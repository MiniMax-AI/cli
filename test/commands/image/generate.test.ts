import { describe, it, expect } from 'bun:test';
import { existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { default as generateCommand } from '../../../src/commands/image/generate';
import { createMockServer, jsonResponse } from '../../helpers/mock-server';

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

  it('fails when the API rejects every image instead of reporting a saved file', async () => {
    const server = createMockServer({
      routes: {
        '/v1/image_generation': () => jsonResponse({
          id: 'req-1',
          data: { image_urls: [], task_id: 'task-1', success_count: 0, failed_count: 1 },
          base_resp: { status_code: 0, status_msg: 'success' },
        }),
      },
    });
    const outPath = join(tmpdir(), `mmx-image-rejected-${process.pid}-${Date.now()}.jpg`);

    try {
      await expect(
        generateCommand.execute(
          { ...baseConfig, baseUrl: server.url, quiet: true },
          { ...baseFlags, quiet: true, prompt: 'A cat', out: outPath },
        ),
      ).rejects.toThrow('Image generation failed: all images were rejected');
      expect(existsSync(outPath)).toBe(false);
    } finally {
      rmSync(outPath, { force: true });
      server.close();
    }
  });
});
