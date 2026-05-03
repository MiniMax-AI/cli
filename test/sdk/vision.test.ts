import { describe, it, expect, afterEach } from 'bun:test';
import { createMockServer, jsonResponse, type MockServer } from '../helpers/mock-server';
import { MiniMaxSDK } from '../../src/sdk';

describe('MiniMaxSDK.vision', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
  });

  it('should describe image successfully', async () => {
    server = createMockServer({
      routes: {
        '/v1/coding_plan/vlm': () => jsonResponse({
          content: 'A beautiful sunset over the ocean',
        }),
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });

    const result = await sdk.vision.describe({
      image: 'data:image/jpeg;base64,dGVzdA==',
    });

    expect(result.content).toBe('A beautiful sunset over the ocean');
  });
});
