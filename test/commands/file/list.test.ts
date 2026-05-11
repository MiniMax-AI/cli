import { describe, it, expect, afterEach } from 'bun:test';
import { default as listCommand } from '../../../src/commands/file/list';
import { createMockServer, jsonResponse, type MockServer } from '../../helpers/mock-server';
import type { Config } from '../../../src/config/schema';
import type { GlobalFlags } from '../../../src/types/flags';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    apiKey: 'test-key',
    region: 'global',
    baseUrl: 'https://api.mmx.io',
    output: 'text',
    timeout: 10,
    verbose: false,
    quiet: false,
    noColor: true,
    yes: false,
    dryRun: false,
    nonInteractive: true,
    async: false,
    ...overrides,
  };
}

const baseFlags: GlobalFlags = {
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

describe('file list command', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
  });

  it('has correct name', () => {
    expect(listCommand.name).toBe('file list');
  });

  it('handles dry run', async () => {
    const output = await captureStdout(async () => {
      await listCommand.execute(makeConfig({ dryRun: true }), baseFlags);
    });

    expect(output).toBe('Would list uploaded files.\n');
  });

  it('shows empty state when no files are returned', async () => {
    server = createMockServer({
      routes: {
        '/v1/files': () => jsonResponse({ base_resp: { status_code: 0, status_msg: '' }, data: [] }),
      },
    });

    const output = await captureStdout(async () => {
      await listCommand.execute(makeConfig({ baseUrl: server.url }), baseFlags);
    });

    expect(output).toBe('No files found.\n');
  });

  it('prints JSON output for file list responses', async () => {
    server = createMockServer({
      routes: {
        '/v1/files': () => jsonResponse({
          base_resp: { status_code: 0, status_msg: '' },
          data: [{
            file_id: 'file-123',
            bytes: 2048,
            created_at: 1700000000,
            filename: 'doc.pdf',
            purpose: 'retrieval',
          }],
        }),
      },
    });

    const output = await captureStdout(async () => {
      await listCommand.execute(makeConfig({ baseUrl: server.url, output: 'json' }), baseFlags);
    });

    const parsed = JSON.parse(output);
    expect(parsed.data[0].file_id).toBe('file-123');
    expect(parsed.data[0].filename).toBe('doc.pdf');
  });
});
