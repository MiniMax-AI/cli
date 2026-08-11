import { afterEach, describe, expect, it } from 'bun:test';
import type { Config } from '../../src/config/schema';
import { MiniMaxSDK } from '../../src/sdk';
import { TextSDK } from '../../src/sdk/text';
import { createMockServer, jsonResponse, type MockServer } from '../helpers/mock-server';

interface ClientState {
  context: object;
  config: Config;
}

function clientState(client: object): ClientState {
  return client as ClientState;
}

describe('SDK client context', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
  });

  it('shares one resolved context and config across all child SDKs', () => {
    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: 'https://example.com',
    });
    const rootState = clientState(sdk);
    const childClients = [
      sdk.text,
      sdk.speech,
      sdk.image,
      sdk.video,
      sdk.music,
      sdk.search,
      sdk.vision,
      sdk.quota,
      sdk.file,
    ];

    for (const child of childClients) {
      expect(clientState(child).context).toBe(rootState.context);
      expect(clientState(child).config).toBe(rootState.config);
    }

    expect(rootState.config.apiKey).toBe('test-key');
    expect(rootState.config.baseUrl).toBe('https://example.com');
  });

  it('preserves direct child SDK construction and request behavior', async () => {
    server = createMockServer({
      routes: {
        '/anthropic/v1/messages': () => jsonResponse({
          id: 'msg-direct',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello!' }],
          model: 'MiniMax-M3',
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      },
    });

    const sdk = new TextSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });
    const result = await sdk.chat({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(result.id).toBe('msg-direct');
  });
});
