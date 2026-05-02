import { describe, it, expect, afterEach } from 'bun:test';
import { createMockServer, jsonResponse, type MockServer } from '../helpers/mock-server';
import { MiniMaxSDK } from '../../src/sdk';

describe('MiniMaxSDK.music', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
  });

  it('should generate music successfully', async () => {
    server = createMockServer({
      routes: {
        '/v1/music_generation': () => jsonResponse({
          data: { audio_url: 'https://example.com/music.mp3' },
          base_resp: { status_code: 0, status_msg: 'success' },
        }),
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });

    const result = await sdk.music.generate({
      lyrics: 'no lyrics',
      instrumental: true,
    });

    expect(result.data.audio_url).toBe('https://example.com/music.mp3');
  });
});
