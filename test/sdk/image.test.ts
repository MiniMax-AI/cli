import { describe, it, expect, afterEach } from 'bun:test';
import { createMockServer, jsonResponse, type MockServer } from '../helpers/mock-server';
import { MiniMaxSDK } from '../../src/sdk';

describe('MiniMaxSDK.image', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
  });

  it('should generate image successfully', async () => {
    server = createMockServer({
      routes: {
        '/v1/image_generation': () => jsonResponse({
          base_resp: { status_code: 0, status_msg: 'success' },
          data: {
            task_id: 'img-123',
            success_count: 1,
            failed_count: 0,
          },
        }),
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });

    const result = await sdk.image.generate({
      prompt: 'A beautiful sunset',
      width: 1024,
      height: 1024,
    });

    expect(result.data.task_id).toBe('img-123');
  });
});
