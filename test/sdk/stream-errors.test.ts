import { afterEach, describe, expect, it } from 'bun:test';
import { MiniMaxSDK } from '../../src/sdk';
import { CLIError } from '../../src/errors/base';
import { ExitCode } from '../../src/errors/codes';
import { createMockServer, sseResponse, type MockServer } from '../helpers/mock-server';

describe('SDK SSE API errors', () => {
  let server: MockServer;

  afterEach(() => server?.close());

  for (const modality of ['text', 'speech', 'transcription'] as const) {
    it(`rejects a ${modality} API error without yielding it or subsequent events`, async () => {
      const first = modality === 'text'
        ? { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Partial' } }
        : modality === 'speech'
          ? { data: { audio: 'abcd', status: 1 }, base_resp: { status_code: 0, status_msg: 'success' } }
          : { delta: 'Partial', index: 0, finish: false };
      const error = modality === 'text'
        ? { type: 'error', error: { type: 'insufficient_balance_error', message: 'Balance exhausted' } }
        : { base_resp: { status_code: 1028, status_msg: 'Insufficient quota' } };
      server = createMockServer({
        routes: {
          '/': () => sseResponse([first, error, first].map(data => ({ data: JSON.stringify(data) }))),
        },
      });
      const sdk = new MiniMaxSDK({ apiKey: 'test-key', region: 'global', baseUrl: server.url });
      const stream = modality === 'text'
        ? await sdk.text.chat({ messages: [{ role: 'user', content: 'Hello' }], stream: true })
        : modality === 'speech'
          ? await sdk.speech.synthesize({ text: 'Hello', stream: true })
          : await sdk.speech.transcribe({ file: new Blob(['audio']), stream: true });

      const initial = await stream.next();
      expect(initial.done).toBe(false);
      expect(initial.value as unknown).toEqual(first);
      let caught: unknown;
      try {
        await stream.next();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(CLIError);
      if (modality === 'speech') {
        expect((caught as CLIError).hint).toContain('Speech models require the Plus plan');
      }
      expect(caught).toMatchObject({
        exitCode: ExitCode.QUOTA,
        message: expect.stringContaining(modality === 'text' ? 'Balance exhausted' : 'Insufficient quota'),
        hint: expect.stringContaining(modality === 'text' ? 'billing' : 'mmx quota show'),
      });
      expect(await stream.next()).toEqual({ value: undefined, done: true });
    });
  }

  it('preserves the content-filter classification of the first speech event', async () => {
    server = createMockServer({
      routes: {
        '/v1/t2a_v2': () => sseResponse([{
          data: JSON.stringify({ base_resp: { status_code: 1027, status_msg: 'output new_sensitive' } }),
        }]),
      },
    });
    const sdk = new MiniMaxSDK({ apiKey: 'test-key', region: 'global', baseUrl: server.url });
    const stream = await sdk.speech.synthesize({ text: 'Hello', stream: true });
    await expect(stream.next()).rejects.toMatchObject({
      exitCode: ExitCode.CONTENT_FILTER,
      message: expect.stringContaining('output new_sensitive'),
    });
  });

  it('preserves the message of an Anthropic-compatible server error', async () => {
    server = createMockServer({
      routes: {
        '/anthropic/v1/messages': () => new Response(
          'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      },
    });
    const sdk = new MiniMaxSDK({ apiKey: 'test-key', region: 'global', baseUrl: server.url });
    const stream = await sdk.text.chat({ messages: [{ role: 'user', content: 'Hello' }], stream: true });
    await expect(stream.next()).rejects.toMatchObject({
      exitCode: ExitCode.GENERAL,
      message: 'API error: Overloaded (HTTP 200)',
    });
  });
});
