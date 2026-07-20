import { afterEach, describe, it, expect } from 'bun:test';
import { default as showCommand } from '../../../src/commands/quota/show';
import { createMockServer, jsonResponse, type MockServer } from '../../helpers/mock-server';

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

describe('quota show command', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
  });

  it('has correct name', () => {
    expect(showCommand.name).toBe('quota show');
  });

  it('handles dry run', async () => {
    let captured = '';
    const origLog = console.log;
    console.log = (msg: string) => { captured += msg; };
    try {
      await showCommand.execute(
        { ...baseConfig, dryRun: true },
        { ...baseFlags, dryRun: true },
      );
      expect(captured).toContain('Would fetch quota');
    } finally {
      console.log = origLog;
    }
  });

  it('honors JSON output resolved from config when no output flag is present', async () => {
    server = createMockServer({
      routes: {
        '/v1/token_plan/remains': () => jsonResponse({
          model_remains: [],
          base_resp: { status_code: 0, status_msg: 'ok' },
        }),
      },
    });

    const originalIsTTY = process.stdout.isTTY;
    const originalLog = console.log;
    let captured = '';
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    console.log = (message: string) => { captured += message; };

    try {
      await showCommand.execute(
        { ...baseConfig, baseUrl: server.url, output: 'json' },
        baseFlags,
      );

      expect(JSON.parse(captured)).toMatchObject({ model_remains: [] });
    } finally {
      console.log = originalLog;
      Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
    }
  });

});
