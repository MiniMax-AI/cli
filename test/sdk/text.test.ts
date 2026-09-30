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

describe('TextSDK.validateParams (model-aware max_tokens + thinking)', () => {
  it('defaults max_tokens to 131072 for M3 when caller omits it', async () => {
    let body: Record<string, unknown> | undefined;
    const server = createMockServer({
      routes: {
        '/anthropic/v1/messages': async (req) => {
          body = await req.json() as Record<string, unknown>;
          return jsonResponse({
            id: 'msg-1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'ok' }],
            model: 'MiniMax-M3',
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          });
        },
      },
    });
    try {
      const sdk = new MiniMaxSDK({ apiKey: 'sk-test', region: 'global', baseUrl: server.url });
      await sdk.text.chat({
        model: 'MiniMax-M3',
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(body?.max_tokens).toBe(131072);
    } finally {
      server.close();
    }
  });

  it('defaults max_tokens to 65536 for M2.7 when caller omits it', async () => {
    let body: Record<string, unknown> | undefined;
    const server = createMockServer({
      routes: {
        '/anthropic/v1/messages': async (req) => {
          body = await req.json() as Record<string, unknown>;
          return jsonResponse({
            id: 'msg-1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'ok' }],
            model: 'MiniMax-M2.7',
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          });
        },
      },
    });
    try {
      const sdk = new MiniMaxSDK({ apiKey: 'sk-test', region: 'global', baseUrl: server.url });
      await sdk.text.chat({
        model: 'MiniMax-M2.7',
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(body?.max_tokens).toBe(65536);
    } finally {
      server.close();
    }
  });

  it('caller-supplied max_tokens overrides the M3 default', async () => {
    let body: Record<string, unknown> | undefined;
    const server = createMockServer({
      routes: {
        '/anthropic/v1/messages': async (req) => {
          body = await req.json() as Record<string, unknown>;
          return jsonResponse({
            id: 'msg-1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'ok' }],
            model: 'MiniMax-M3',
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          });
        },
      },
    });
    try {
      const sdk = new MiniMaxSDK({ apiKey: 'sk-test', region: 'global', baseUrl: server.url });
      await sdk.text.chat({
        model: 'MiniMax-M3',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(body?.max_tokens).toBe(100);
    } finally {
      server.close();
    }
  });

  it('omits thinking field when caller does not pass it', async () => {
    let body: Record<string, unknown> | undefined;
    const server = createMockServer({
      routes: {
        '/anthropic/v1/messages': async (req) => {
          body = await req.json() as Record<string, unknown>;
          return jsonResponse({
            id: 'msg-1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'ok' }],
            model: 'MiniMax-M3',
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          });
        },
      },
    });
    try {
      const sdk = new MiniMaxSDK({ apiKey: 'sk-test', region: 'global', baseUrl: server.url });
      await sdk.text.chat({
        model: 'MiniMax-M3',
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect('thinking' in (body ?? {})).toBe(false);
    } finally {
      server.close();
    }
  });

  it('passes through thinking: { type: "enabled" } when caller sets it', async () => {
    let body: Record<string, unknown> | undefined;
    const server = createMockServer({
      routes: {
        '/anthropic/v1/messages': async (req) => {
          body = await req.json() as Record<string, unknown>;
          return jsonResponse({
            id: 'msg-1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'ok' }],
            model: 'MiniMax-M3',
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          });
        },
      },
    });
    try {
      const sdk = new MiniMaxSDK({ apiKey: 'sk-test', region: 'global', baseUrl: server.url });
      await sdk.text.chat({
        model: 'MiniMax-M3',
        messages: [{ role: 'user', content: 'hi' }],
        thinking: { type: 'enabled' },
      });
      expect(body?.thinking).toEqual({ type: 'enabled' });
    } finally {
      server.close();
    }
  });
});
