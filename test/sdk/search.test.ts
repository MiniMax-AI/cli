import { describe, it, expect, afterEach } from 'bun:test';
import { createMockServer, jsonResponse, type MockServer } from '../helpers/mock-server';
import { MiniMaxSDK } from '../../src/sdk';

describe('MiniMaxSDK.search', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
  });

  it('should search successfully', async () => {
    server = createMockServer({
      routes: {
        '/v1/coding_plan/search': () => jsonResponse({
          organic: [
            { title: 'Test Result', link: 'https://example.com', snippet: 'A test snippet', date: '2024-01-01' },
          ],
        }),
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });

    const result = await sdk.search.query('test query');

    expect(result.organic).toHaveLength(1);
    expect(result.organic[0].title).toBe('Test Result');
  });
});
