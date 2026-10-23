import { describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { default as generateCommand } from '../../../src/commands/image/generate';

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

  it.each(['http-image-', 'https-image-'])('encodes a local subject reference under %s', async (prefix) => {
    const dir = mkdtempSync(prefix);
    const file = join(dir, 'reference.png');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0qQAAAAASUVORK5CYII=', 'base64');
    const originalLog = console.log;
    let output = '';
    console.log = (message: string) => { output += message; };
    try {
      writeFileSync(file, png);
      await generateCommand.execute(
        { ...baseConfig, dryRun: true, output: 'json' },
        { ...baseFlags, dryRun: true, prompt: 'A cat', subjectRef: `type=character,image=${file}` },
      );
      const reference = JSON.parse(output).request.subject_reference[0];
      expect(reference).toEqual({ type: 'character', image_file: `data:image/png;base64,${png.toString('base64')}` });
    } finally {
      console.log = originalLog;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(['http://example.com/reference.png', 'https://example.com/reference.png'])('preserves remote subject reference %s', async (url) => {
    const originalLog = console.log;
    let output = '';
    console.log = (message: string) => { output += message; };
    try {
      await generateCommand.execute(
        { ...baseConfig, dryRun: true, output: 'json' },
        { ...baseFlags, dryRun: true, prompt: 'A cat', subjectRef: `type=character,image=${url}` },
      );
      expect(JSON.parse(output).request.subject_reference).toEqual([{ type: 'character', image_url: url }]);
    } finally {
      console.log = originalLog;
    }
  });
});
