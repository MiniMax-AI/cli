import { afterEach, describe, it, expect } from 'bun:test';
import { default as showCommand } from '../../../src/commands/quota/show';
import { createMockServer, jsonResponse, type MockServer } from '../../helpers/mock-server';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  output: 'text' as const,
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
  let server: MockServer | undefined;
  const originalConfigDir = process.env.MMX_CONFIG_DIR;

  afterEach(() => {
    server?.close();
    if (originalConfigDir === undefined) delete process.env.MMX_CONFIG_DIR;
    else process.env.MMX_CONFIG_DIR = originalConfigDir;
    server = undefined;
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

  it('uses account/query_balance for sk-api keys', async () => {
    server = createMockServer({
      routes: {
        '/account/query_balance': (req) => {
          if (req.headers.get('Authorization') === 'Bearer sk-api-secret-key') {
            return jsonResponse({
              available_amount: '98.00',
              cash_balance: '0.00',
              voucher_balance: '98.00',
              credit_balance: '0.00',
              owed_amount: '0.00',
              balance_alert_switch: false,
              balance_alert_threshold: '',
              base_resp: { status_code: 0, status_msg: 'success' },
            });
          }
          return jsonResponse({ error: 'unauthorized' }, 401);
        },
      },
    });

    const configDir = mkdtempSync(join(tmpdir(), 'mmx-quota-balance-'));
    process.env.MMX_CONFIG_DIR = configDir;
    const origLog = console.log;

    try {
      const output: string[] = [];
      console.log = (msg: string) => { output.push(msg); };

      await showCommand.execute(
        {
          ...baseConfig,
          apiKey: 'sk-api-secret-key',
          baseUrl: server.url,
        },
        { ...baseFlags, output: 'text' as const },
      );

      expect(output.join('\n')).toContain('Account Balance:');
      expect(output.join('\n')).toContain('98.00');
    } finally {
      console.log = origLog;
      rmSync(configDir, { recursive: true, force: true });
    }
  });

});
