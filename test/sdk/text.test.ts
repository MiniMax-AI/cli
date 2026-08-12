import { describe, it, expect, afterEach } from 'bun:test';
import { createMockServer, jsonResponse, sseResponse, type MockServer } from '../helpers/mock-server';
import { MiniMaxSDK } from '../../src/sdk';
import { TextSDK } from '../../src/sdk/text';

describe('MiniMaxSDK.text', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
  });

  it('should chat successfully', async () => {
    server = createMockServer({
      routes: {
        '/anthropic/v1/messages': () => jsonResponse({
          id: 'msg-123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello!' }],
          model: 'MiniMax-M3',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });

    const result = await sdk.text.chat({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(result.id).toBe('msg-123');
  });

  it('passes video content blocks through to chat requests', async () => {
    let requestBody: unknown;
    server = createMockServer({
      routes: {
        '/anthropic/v1/messages': async request => {
          requestBody = await request.json();
          return jsonResponse({
            id: 'msg-video',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'A short clip.' }],
            model: 'MiniMax-M3',
            stop_reason: 'end_turn',
            usage: { input_tokens: 20, output_tokens: 4 },
          });
        },
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });

    await sdk.text.chat({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'What happens in this clip?' },
          {
            type: 'video',
            source: {
              type: 'url',
              url: 'https://example.com/clip.mp4',
              detail: 'high',
              fps: 0.5,
              max_long_side_pixel: 1280,
            },
          },
        ],
      }],
    });

    expect(requestBody).toMatchObject({
      model: 'MiniMax-M3',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'What happens in this clip?' },
          {
            type: 'video',
            source: {
              type: 'url',
              url: 'https://example.com/clip.mp4',
              detail: 'high',
              fps: 0.5,
              max_long_side_pixel: 1280,
            },
          },
        ],
      }],
    });
  });

  it('streaming skips empty SSE data events', async () => {
    const chunk = JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Hi' },
    });

    server = createMockServer({
      routes: {
        '/anthropic/v1/messages': () => sseResponse([
          { data: chunk },
          { data: '' },
          { data: chunk },
        ]),
      },
    });

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url,
    });

    const stream = await sdk.text.chat({
      messages: [{ role: 'user', content: 'Hi' }],
      stream: true,
    });

    const events = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events.length).toBe(2);
    expect(events[0].type).toBe('content_block_delta');
    expect(events[1].type).toBe('content_block_delta');
  });
});

describe('TextSDK.validateParams', () => {
  const sdk = new TextSDK({ apiKey: 'sk-test', region: 'global' });

  it('throws when messages array is empty', async () => {
    await expect(sdk.chat({ messages: [] })).rejects.toThrow('At least one message is required');
  });

  it('applies defaults for model and max_tokens', async () => {
    await expect(
      sdk.chat({ messages: [{ role: 'user', content: 'Hi' }] }),
    ).rejects.not.toThrow('At least one message');
  });
});
