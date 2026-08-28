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

  it('honors JSON output resolved from config without an output flag', async () => {
    server = createMockServer({
      routes: {
        '/v1/token_plan/remains': () => jsonResponse({
          model_remains: [],
          base_resp: { status_code: 0, status_msg: 'ok' },
        }),
      },
    });

    const output: string[] = [];
    const originalLog = console.log;
    const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    console.log = (message?: unknown) => { output.push(String(message ?? '')); };
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

    try {
      await showCommand.execute(
        { ...baseConfig, baseUrl: server.url, output: 'json' },
        { ...baseFlags, output: undefined },
      );
    } finally {
      console.log = originalLog;
      if (ttyDescriptor) {
        Object.defineProperty(process.stdout, 'isTTY', ttyDescriptor);
      } else {
        delete (process.stdout as unknown as Record<string, unknown>).isTTY;
      }
    }

    expect(JSON.parse(output.join('\n'))).toMatchObject({ model_remains: [] });
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

  it('normalizes ambiguous quota counts in quiet output', async () => {
    server = createMockServer({
      routes: {
        '/v1/token_plan/remains': () => jsonResponse({
          model_remains: [
            {
              model_name: 'legacy-video',
              current_interval_total_count: 3,
              current_interval_usage_count: 3,
              current_interval_remaining_percent: 100,
            },
            {
              model_name: 'current-video',
              current_interval_total_count: 5,
              current_interval_usage_count: 0,
              current_interval_remaining_percent: 100,
            },
            {
              model_name: 'general',
              current_interval_total_count: 0,
              current_interval_usage_count: 0,
              current_interval_remaining_percent: 99,
            },
          ],
        }),
      },
    });

    const output: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => { output.push(msg); };

    try {
      await showCommand.execute(
        {
          ...baseConfig,
          baseUrl: server.url,
          quiet: true,
        },
        { ...baseFlags, quiet: true },
      );
    } finally {
      console.log = origLog;
    }

    expect(output).toEqual([
      'legacy-video\t0\t3\t3',
      'current-video\t0\t5\t5',
      'general\t-\t0\t99%',
    ]);
  });

});
