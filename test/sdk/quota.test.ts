import { describe, it, expect, mock } from 'bun:test';
import { MiniMaxSDK } from '../../src/sdk';

describe('MiniMaxSDK.quota', () => {
  it('should get quota info successfully', async () => {
    const mockFetch = mock(async (url: string) => {
      if (url.includes('/v1/token_plan/remains')) {
        return new Response(JSON.stringify({
          model_remains: [
            {
              model_name: 'MiniMax-M2.7',
              start_time: 0,
              end_time: 9999999999,
              remains_time: 1000,
              current_interval_total_count: 1000,
              current_interval_usage_count: 500,
              current_weekly_total_count: 5000,
              current_weekly_usage_count: 2000,
              weekly_start_time: 0,
              weekly_end_time: 9999999999,
              weekly_remains_time: 3000,
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not found', { status: 404 });
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      const sdk = new MiniMaxSDK({
        apiKey: 'test-key',
      });

      const result = await sdk.quota.info();

      expect(result.model_remains).toHaveLength(1);
      expect(result.model_remains[0].model_name).toBe('MiniMax-M2.7');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
