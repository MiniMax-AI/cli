import { describe, it, expect, afterEach } from 'bun:test';
import { createMockServer, jsonResponse, type MockServer } from '../helpers/mock-server';
import { MiniMaxSDK } from '../../src/sdk';

describe('MiniMaxSDK.video', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
  });

  it('should generate video async successfully', async () => {
    server = createMockServer({
      routes: {
        '/v1/video_generation': () => jsonResponse({
          task_id: 'vid-123',
          base_resp: { status_code: 0, status_msg: 'success' },
        }),
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });

    const result = await sdk.video.generate({
      prompt: 'A cat walking',
      async: true,
    });

    expect(result.taskId).toBe('vid-123');
  });

  it('should get task status', async () => {
    server = createMockServer({
      routes: {
        '/v1/query/video_generation': () => jsonResponse({
          task_id: 'vid-123',
          status: 'Success',
          base_resp: { status_code: 0, status_msg: 'success' },
        }),
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });

    const result = await sdk.video.getTask({ taskId: 'vid-123' });

    expect(result.status).toBe('Success');
  });
});
