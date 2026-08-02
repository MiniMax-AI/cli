import { describe, it, expect } from 'bun:test';
import { default as cloneCommand } from '../../../src/commands/speech/clone';

const baseConfig = {
  apiKey: 'test-key',
  region: 'global' as const,
  baseUrl: 'https://api.mmx.io',
  output: 'json' as const,
  timeout: 10,
  verbose: false,
  quiet: false,
  noColor: true,
  yes: false,
  dryRun: true,
  nonInteractive: true,
  async: false,
};

const baseFlags = {
  quiet: false,
  verbose: false,
  noColor: true,
  yes: false,
  dryRun: true,
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

describe('speech clone command', () => {
  it('has correct name', () => {
    expect(cloneCommand.name).toBe('speech clone');
  });

  it('requires clone input audio', async () => {
    await expect(
      cloneCommand.execute(baseConfig, { ...baseFlags, voiceId: 'my_voice' }),
    ).rejects.toThrow('--file-id or --file is required');
  });

  it('builds clone request with the default HD model', async () => {
    const output = await captureStdout(async () => {
      await cloneCommand.execute(baseConfig, {
        ...baseFlags,
        fileId: 'file-123',
        voiceId: 'my_voice',
      });
    });

    const parsed = JSON.parse(output);
    expect(parsed.request).toEqual({
      file_id: 'file-123',
      voice_id: 'my_voice',
      model: 'speech-2.8-hd',
    });
  });

  it('includes voice_clone upload purpose when a local file is used', async () => {
    const output = await captureStdout(async () => {
      await cloneCommand.execute(baseConfig, {
        ...baseFlags,
        file: 'sample.wav',
        voiceId: 'my_voice',
        model: 'speech-2.6-hd',
      });
    });

    const parsed = JSON.parse(output);
    expect(parsed.request.upload.purpose).toBe('voice_clone');
    expect(parsed.request.clone).toEqual({
      file_id: '<uploaded-file-id>',
      voice_id: 'my_voice',
      model: 'speech-2.6-hd',
    });
  });
});
