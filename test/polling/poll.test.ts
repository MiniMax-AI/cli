import { describe, it, expect, mock, afterEach } from 'bun:test';
import type { Config } from '../../src/config/schema';

// Silence the spinner — purely visual, no impact on logic.
// Must re-export all symbols so other test files don't break.
mock.module('../../src/output/progress', () => ({
  createSpinner: () => ({ start: () => {}, stop: () => {}, update: () => {} }),
  createProgressBar: () => ({ update: () => {}, finish: () => {} }),
}));

const baseConfig: Config = {
  apiKey: 'sk-test',
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
};

function jsonRes(body: unknown): Response {
  return {
    status: 200,
    ok: true,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => body,
  } as Response;
}

const originalFetch = globalThis.fetch;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setFetch(fn: any): void {
  globalThis.fetch = fn as typeof globalThis.fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('poll', () => {
  it('completes when isComplete returns true', async () => {
    let callCount = 0;
    setFetch(mock(() => {
      callCount++;
      return Promise.resolve(jsonRes({ status: 'Success', task_id: 'task-1' }));
    }));

    const { poll } = await import('../../src/polling/poll');
    const result = await poll(baseConfig, {
      url: 'https://api.mmx.io/poll',
      intervalSec: 0.01,
      timeoutSec: 5,
      isComplete: (d) => (d as Record<string, unknown>).status === 'Success',
      isFailed: () => false,
    });

    expect((result as Record<string, unknown>).status).toBe('Success');
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  it('throws on isFailed with status message', async () => {
    setFetch(mock(() => Promise.resolve(
      jsonRes({ status: 'Failed', base_resp: { status_code: 1, status_msg: 'Task error' } }),
    )));

    const { poll } = await import('../../src/polling/poll');
    await expect(
      poll(baseConfig, {
        url: 'https://api.mmx.io/poll',
        intervalSec: 0.01,
        timeoutSec: 5,
        isComplete: () => false,
        isFailed: (d) => (d as Record<string, unknown>).status === 'Failed',
        getStatus: (d) => (d as Record<string, unknown>).status as string,
      }),
    ).rejects.toThrow('Task error');
  });

  it('includes a structured failure reason when provided', async () => {
    setFetch(mock(() => Promise.resolve(jsonRes({
      task: {
        status: 'failed',
        error: { code: 'H3_FAILED', message: 'Reference video could not be decoded' },
      },
    }))));

    const { poll } = await import('../../src/polling/poll');
    await expect(
      poll(baseConfig, {
        url: 'https://api.mmx.io/poll',
        intervalSec: 0.01,
        timeoutSec: 5,
        isComplete: () => false,
        isFailed: (data) => (
          data as { task: { status: string } }
        ).task.status === 'failed',
        getStatus: (data) => (
          data as { task: { status: string } }
        ).task.status,
        getFailureReason: (data) => {
          const error = (
            data as { task: { error?: { code?: string; message?: string } } }
          ).task.error;
          return [error?.code, error?.message].filter(Boolean).join(': ');
        },
      }),
    ).rejects.toThrow('H3_FAILED: Reference video could not be decoded');
  });

  it('throws on timeout', async () => {
    setFetch(mock(() => Promise.resolve(jsonRes({ status: 'Processing' }))));

    const { poll } = await import('../../src/polling/poll');
    await expect(
      poll(baseConfig, {
        url: 'https://api.mmx.io/poll',
        intervalSec: 0.01,
        timeoutSec: 0.02,
        isComplete: () => false,
        isFailed: () => false,
      }),
    ).rejects.toThrow('Polling timed out');
  });

  it('returns immediately when first request succeeds', async () => {
    let callCount = 0;
    setFetch(mock(() => {
      callCount++;
      return Promise.resolve(jsonRes({ status: 'Success' }));
    }));

    const { poll } = await import('../../src/polling/poll');
    const result = await poll(baseConfig, {
      url: 'https://api.mmx.io/poll',
      intervalSec: 0.01,
      timeoutSec: 5,
      isComplete: () => true,
      isFailed: () => false,
    });

    expect(callCount).toBe(1);
    expect(result).toBeDefined();
  });
});
