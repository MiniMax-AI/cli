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
    try {
      await uploadCommand.execute(baseConfig, {
        ...baseFlags,
        file: '/tmp/nonexistent-file-xxxxx.bin',
      });
      throw new Error('Expected upload to reject');
    } catch (error) {
      expect(error).toMatchObject({
        name: 'CLIError',
        message: expect.stringContaining('File not found'),
        exitCode: 2,
      });
    }
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

  it('uploads through the shared multipart operation and formats the response', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mmx-upload-test-'));
    const filePath = join(tempDir, 'fixture.txt');
    writeFileSync(filePath, 'shared upload contents');
    const originalFetch = globalThis.fetch;
    let requestUrl = '';
    let requestInit: RequestInit | undefined;

    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({
        base_resp: { status_code: 0, status_msg: 'success' },
        file: {
          file_id: 'cli-file-id',
          bytes: 22,
          created_at: 1,
          filename: 'fixture.txt',
          purpose: 'vision',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const captured = await captureStdout(async () => {
        await uploadCommand.execute(baseConfig, {
          ...baseFlags,
          file: filePath,
          purpose: 'vision',
        });
      });

      expect(requestUrl).toBe('https://api.mmx.io/v1/files/upload');
      expect(requestInit?.method).toBe('POST');
      expect(requestInit?.headers).toMatchObject({ Authorization: 'Bearer test-key' });
      expect(requestInit?.body).toBeInstanceOf(FormData);

      const body = requestInit?.body as FormData;
      const uploadedFile = body.get('file');
      expect(uploadedFile).toBeInstanceOf(Blob);
      expect((uploadedFile as File).name).toBe('fixture.txt');
      expect(await (uploadedFile as Blob).text()).toBe('shared upload contents');
      expect(body.get('purpose')).toBe('vision');
      expect(captured).toContain('cli-file-id');
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
