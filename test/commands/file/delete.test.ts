import { describe, it, expect, afterEach } from 'bun:test';
import { default as deleteCommand } from '../../../src/commands/file/delete';
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

describe('file delete command', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
  });

  it('has correct name', () => {
    expect(deleteCommand.name).toBe('file delete');
  });

  it('requires file-id argument', async () => {
    await expect(
      deleteCommand.execute(makeConfig({ dryRun: true }), baseFlags),
    ).rejects.toThrow('Missing required argument: --file-id');
  });

  it('handles dry run', async () => {
    const output = await captureStdout(async () => {
      await deleteCommand.execute(makeConfig({ dryRun: true, output: 'json' }), {
        ...baseFlags,
        dryRun: true,
        fileId: '123',
      });
    });

    const parsed = JSON.parse(output);
    expect(parsed.request.delete_file).toBe('123');
  });

  it('rejects an invalid file ID locally', async () => {
    await expect(
      deleteCommand.execute(makeConfig({ dryRun: true }), {
        ...baseFlags,
        dryRun: true,
        fileId: '123.4',
      }),
    ).rejects.toThrow('--file-id must be a positive decimal integer within the int64 range.');
  });

  it('sends a file ID above Number.MAX_SAFE_INTEGER as a decimal string', async () => {
    const fileId = '9223372036854775807';
    let method = '';
    let body: Record<string, unknown> = {};
    server = createMockServer({
      routes: {
        '/v1/files/delete': async (req) => {
          method = req.method;
          body = await req.json() as Record<string, unknown>;
          return jsonResponse({
            base_resp: { status_code: 0, status_msg: '' },
            file_id: fileId,
          });
        },
      },
    });

    const output = await captureStdout(async () => {
      await deleteCommand.execute(makeConfig({ baseUrl: server.url, output: 'json' }), {
        ...baseFlags,
        fileId,
      });
    });

    const parsed = JSON.parse(output);
    expect(method).toBe('POST');
    expect(body.file_id).toBe(fileId);
    expect(parsed).toEqual({ file_id: fileId, deleted: true });
  });

  it('prints compact status in quiet mode', async () => {
    server = createMockServer({
      routes: {
        '/v1/files/delete': () => jsonResponse({
          base_resp: { status_code: 0, status_msg: '' },
          file_id: '123',
        }),
      },
    });

    const output = await captureStdout(async () => {
      await deleteCommand.execute(makeConfig({ baseUrl: server.url, quiet: true }), {
        ...baseFlags,
        quiet: true,
        fileId: '123',
      });
    });

    expect(output).toBe('deleted\n');
  });
});
