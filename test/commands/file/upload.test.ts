import { describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { default as uploadCommand } from '../../../src/commands/file/upload';

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

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const originalWrite = process.stdout.write;
  let output = '';
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    return true;
  }) as typeof process.stdout.write;

  try {
    await fn();
    return output;
  } finally {
    process.stdout.write = originalWrite;
  }
}

describe('file upload command', () => {
  it('has correct name', () => {
    expect(uploadCommand.name).toBe('file upload');
  });

  it('requires file argument in non-interactive mode', async () => {
    await expect(
      uploadCommand.execute(baseConfig, baseFlags),
    ).rejects.toThrow('Missing required argument: --file');
  });

  it('throws when file does not exist', async () => {
    await expect(
      uploadCommand.execute(baseConfig, { ...baseFlags, file: '/tmp/nonexistent-file-xxxxx.bin' }),
    ).rejects.toThrow('File not found');
  });

  it('shows dry-run output with file info', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mmx-upload-test-'));
    const filePath = join(tempDir, 'fixture.bin');
    writeFileSync(filePath, 'fixture');

    try {
      const captured = await captureStdout(async () => {
        await uploadCommand.execute(
          { ...baseConfig, dryRun: true },
          { ...baseFlags, dryRun: true, file: filePath, purpose: 'vision' },
        );
      });

      expect(captured).toContain(filePath);
      expect(captured).toContain('vision');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
