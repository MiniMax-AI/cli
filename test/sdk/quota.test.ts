import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isAccountBalanceResponse,
  isQuotaResponse,
  MiniMaxSDK,
} from '../../src/sdk';
import { createMockServer, jsonResponse, type MockServer } from '../helpers/mock-server';

const quotaResponse = {
  model_remains: [
    {
      model_name: 'MiniMax-M3',
      start_time: 0,
      end_time: 9999999999,
      remains_time: 1000,
      current_interval_total_count: 1000,
      current_interval_usage_count: 500,
      current_interval_remaining_percent: 50,
      current_weekly_total_count: 5000,
      current_weekly_usage_count: 2000,
      weekly_start_time: 0,
      weekly_end_time: 9999999999,
      weekly_remains_time: 3000,
    },
  ],
};

const balanceResponse = {
  available_amount: '98.00',
  cash_balance: '0.00',
  voucher_balance: '98.00',
  credit_balance: '0.00',
  owed_amount: '0.00',
  balance_alert_switch: false,
  balance_alert_threshold: '',
  base_resp: { status_code: 0, status_msg: 'success' },
};

describe('MiniMaxSDK.quota', () => {
  let server: MockServer | undefined;
  let configDir: string | undefined;
  const originalConfigDir = process.env.MMX_CONFIG_DIR;

  afterEach(() => {
    server?.close();
    if (configDir) rmSync(configDir, { recursive: true, force: true });
    if (originalConfigDir === undefined) delete process.env.MMX_CONFIG_DIR;
    else process.env.MMX_CONFIG_DIR = originalConfigDir;
    server = undefined;
    configDir = undefined;
  });

  function useIsolatedConfig(config: Record<string, unknown> = {}): void {
    configDir = mkdtempSync(join(tmpdir(), 'mmx-sdk-quota-'));
    process.env.MMX_CONFIG_DIR = configDir;
    writeFileSync(join(configDir, 'config.json'), JSON.stringify(config));
  }

  it('uses token_plan/remains for a regular API key from options', async () => {
    const requests: Array<{
      url: string;
      authorization: string | null;
      xApiKey: string | null;
    }> = [];
    server = createMockServer({
      routes: {
        '/v1/token_plan/remains': (req) => {
          requests.push({
            url: req.url,
            authorization: req.headers.get('Authorization'),
            xApiKey: req.headers.get('x-api-key'),
          });
          return jsonResponse(quotaResponse);
        },
      },
    });
    useIsolatedConfig();

    const sdk = new MiniMaxSDK({ apiKey: 'regular-api-key', baseUrl: server.url });
    const result = await sdk.quota.info();

    expect(requests).toEqual([
      {
        url: `${server.url}/v1/token_plan/remains`,
        authorization: 'Bearer regular-api-key',
        xApiKey: null,
      },
    ]);
    expect(isQuotaResponse(result)).toBe(true);
    if (!isQuotaResponse(result)) throw new Error('Expected a quota response');
    expect(result.model_remains[0].model_name).toBe('MiniMax-M3');
  });

  it('uses account/query_balance for an sk-api key from options', async () => {
    const requests: Array<{
      url: string;
      authorization: string | null;
      xApiKey: string | null;
    }> = [];
    server = createMockServer({
      routes: {
        '/account/query_balance': (req) => {
          requests.push({
            url: req.url,
            authorization: req.headers.get('Authorization'),
            xApiKey: req.headers.get('x-api-key'),
          });
          return jsonResponse(balanceResponse);
        },
      },
    });
    useIsolatedConfig();

    const sdk = new MiniMaxSDK({ apiKey: 'sk-api-secret-key', baseUrl: server.url });
    const result = await sdk.quota.info();

    expect(requests).toEqual([
      {
        url: `${server.url}/account/query_balance`,
        authorization: 'Bearer sk-api-secret-key',
        xApiKey: null,
      },
    ]);
    expect(isAccountBalanceResponse(result)).toBe(true);
    if (!isAccountBalanceResponse(result)) throw new Error('Expected an account balance response');
    expect(result.available_amount).toBe('98.00');
  });

  it('uses an sk-api key from the CLI config file', async () => {
    const requests: Array<{
      url: string;
      authorization: string | null;
      xApiKey: string | null;
    }> = [];
    server = createMockServer({
      routes: {
        '/account/query_balance': (req) => {
          requests.push({
            url: req.url,
            authorization: req.headers.get('Authorization'),
            xApiKey: req.headers.get('x-api-key'),
          });
          return jsonResponse(balanceResponse);
        },
      },
    });
    useIsolatedConfig({ api_key: 'sk-api-config-key' });

    const sdk = new MiniMaxSDK({ baseUrl: server.url });
    const result = await sdk.quota.info();

    expect(requests).toEqual([
      {
        url: `${server.url}/account/query_balance`,
        authorization: 'Bearer sk-api-config-key',
        xApiKey: null,
      },
    ]);
    expect(isAccountBalanceResponse(result)).toBe(true);
  });

  it('uses token_plan/remains for OAuth even when its token has an sk-api prefix', async () => {
    const requests: Array<{
      url: string;
      authorization: string | null;
      xApiKey: string | null;
    }> = [];
    server = createMockServer({
      routes: {
        '/v1/token_plan/remains': (req) => {
          requests.push({
            url: req.url,
            authorization: req.headers.get('Authorization'),
            xApiKey: req.headers.get('x-api-key'),
          });
          return jsonResponse(quotaResponse);
        },
      },
    });
    useIsolatedConfig({
      oauth: {
        access_token: 'sk-api-oauth-token',
        refresh_token: 'refresh-token',
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    });

    const sdk = new MiniMaxSDK({ baseUrl: server.url });
    const result = await sdk.quota.info();

    expect(requests).toEqual([
      {
        url: `${server.url}/v1/token_plan/remains`,
        authorization: 'Bearer sk-api-oauth-token',
        xApiKey: null,
      },
    ]);
    expect(isQuotaResponse(result)).toBe(true);
  });
});
