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
        fileId: 'file-123',
      });
    });

    const parsed = JSON.parse(output);
    expect(parsed.request.delete_file).toBe('file-123');
  });

  it('sends DELETE request and prints result', async () => {
    let method = '';
    let fileId = '';
    server = createMockServer({
      routes: {
        '/v1/files': (req) => {
          method = req.method;
          fileId = new URL(req.url).searchParams.get('file_id') ?? '';
          return jsonResponse({
            base_resp: { status_code: 0, status_msg: '' },
            id: fileId,
            object: 'file',
            deleted: true,
          });
        },
      },
    });

    const output = await captureStdout(async () => {
      await deleteCommand.execute(makeConfig({ baseUrl: server.url, output: 'json' }), {
        ...baseFlags,
        fileId: 'file-123',
      });
    });

    const parsed = JSON.parse(output);
    expect(method).toBe('DELETE');
    expect(fileId).toBe('file-123');
    expect(parsed).toEqual({ id: 'file-123', deleted: true });
  });

  it('prints compact status in quiet mode', async () => {
    server = createMockServer({
      routes: {
        '/v1/files': () => jsonResponse({
          base_resp: { status_code: 0, status_msg: '' },
          id: 'file-123',
          object: 'file',
          deleted: true,
        }),
      },
    });

    const output = await captureStdout(async () => {
      await deleteCommand.execute(makeConfig({ baseUrl: server.url, quiet: true }), {
        ...baseFlags,
        quiet: true,
        fileId: 'file-123',
      });
    });

    expect(output).toBe('deleted\n');
  });
});
