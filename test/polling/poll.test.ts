import { describe, it, expect, mock, afterEach, spyOn } from 'bun:test';
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

  it('does not sleep for the full polling interval when the timeout is shorter', async () => {
    setFetch(mock(() => Promise.resolve(jsonRes({ status: 'Processing' }))));
    const { poll } = await import('../../src/polling/poll');
    const started = performance.now();

    await expect(poll(baseConfig, {
      url: 'https://api.mmx.io/poll',
      intervalSec: 1.5,
      timeoutSec: 0.05,
      isComplete: () => false,
      isFailed: () => false,
    })).rejects.toThrow('Polling timed out');

    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('aborts a pending status request at the polling deadline', async () => {
    let signal: AbortSignal | undefined;
    let callCount = 0;
    setFetch(async (_input: unknown, init: RequestInit) => {
      callCount++;
      signal = init.signal ?? undefined;
      return await new Promise<Response>((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
      });
    });
    const { poll } = await import('../../src/polling/poll');
    const started = performance.now();

    await expect(poll({ ...baseConfig, timeout: 1 }, {
      url: 'https://api.mmx.io/poll',
      intervalSec: 0,
      timeoutSec: 0.05,
      isComplete: () => false,
      isFailed: () => false,
    })).rejects.toMatchObject({ name: 'TimeoutError' });

    expect(signal?.aborted).toBe(true);
    expect(callCount).toBe(1);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it.each([
    [100, 80, 20],
    [3000, 993, 2007],
    [2000, 999, 1001],
  ])('reduces a %s ms polling budget by %s ms to %s ms', async (budget, elapsed, remaining) => {
    let now = 1_000;
    let callCount = 0;
    const clock = spyOn(Date, 'now').mockImplementation(() => now);
    const timeout = spyOn(AbortSignal, 'timeout');
    setFetch(async () => {
      callCount++;
      if (callCount === 1) now += elapsed;
      return jsonRes({ status: callCount === 1 ? 'Processing' : 'Success' });
    });

    try {
      const { poll } = await import('../../src/polling/poll');
      await poll(baseConfig, {
        url: 'https://api.mmx.io/poll',
        intervalSec: 0,
        timeoutSec: budget / 1000,
        isComplete: (data) => (data as { status: string }).status === 'Success',
        isFailed: () => false,
      });

      expect(timeout.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([budget, remaining]);
      expect(callCount).toBe(2);
    } finally {
      timeout.mockRestore();
      clock.mockRestore();
    }
  });

  it.each([0.01, 2.007])('preserves a shorter %s second per-request timeout', async (seconds) => {
    const timeout = spyOn(AbortSignal, 'timeout');
    setFetch(async () => jsonRes({ status: 'Success' }));

    try {
      const { poll } = await import('../../src/polling/poll');
      await poll({ ...baseConfig, timeout: seconds }, {
        url: 'https://api.mmx.io/poll',
        intervalSec: 0,
        timeoutSec: 5,
        isComplete: () => true,
        isFailed: () => false,
      });

      expect(timeout).toHaveBeenCalledWith(Math.round(seconds * 1000));
    } finally {
      timeout.mockRestore();
    }
  });

  it.each(['headers', 'body', 'error body'])('times out when real HTTP response %s stall', async (phase) => {
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch() {
        if (phase === 'headers') return new Promise<Response>(() => {});
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"status":'));
          },
        }), {
          status: phase === 'error body' ? 500 : 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    setFetch(originalFetch);
    const started = performance.now();

    try {
      const { poll } = await import('../../src/polling/poll');
      await expect(poll({ ...baseConfig, timeout: 1 }, {
        url: `http://127.0.0.1:${server.port}/poll`,
        intervalSec: 0,
        timeoutSec: 0.05,
        isComplete: () => false,
        isFailed: () => false,
      })).rejects.toMatchObject({ name: 'TimeoutError' });
      expect(performance.now() - started).toBeLessThan(500);
    } finally {
      server.stop(true);
    }
  });
});
