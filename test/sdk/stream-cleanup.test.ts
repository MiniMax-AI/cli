import { describe, expect, it, mock } from 'bun:test';
import { parseSSE } from '../../src/client/stream';
import { MiniMaxSDK } from '../../src/sdk';
import { withStubbedFetch } from '../helpers/fetch-stub';

function trackedResponse(chunks: string[], options: { eof?: boolean; cancelError?: Error } = {}) {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let open = true;
  const cancel = mock(() => {
    open = false;
    if (options.cancelError) throw options.cancelError;
  });
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
      if (options.eof) {
        open = false;
        c.close();
      }
    },
    cancel,
  });
  return {
    response: new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
    cancel,
    fail(error: Error) {
      open = false;
      controller.error(error);
    },
    close() {
      // Also release the fixture's pending read if a regression assertion fails.
      if (open) {
        open = false;
        controller.close();
      }
    },
  };
}

async function collect<T>(stream: AsyncGenerator<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const sdk = new MiniMaxSDK({ apiKey: 'test-key', region: 'global', baseUrl: 'https://sdk.test.invalid' });
const streams: Array<{ name: string; start: () => Promise<AsyncGenerator<unknown>> }> = [
  {
    name: 'text chat',
    start: () => sdk.text.chat({ messages: [{ role: 'user', content: 'Hi' }], stream: true }),
  },
  {
    name: 'speech synthesis',
    start: () => sdk.speech.synthesize({ text: 'Hi', stream: true }),
  },
];

for (const { name, start } of streams) {
  describe(`${name} stream cleanup`, () => {
    it('cancels the response at [DONE] without waiting for EOF', async () => {
      const fixture = trackedResponse(['data: {"value":1}\n\ndata: [DONE]\n\ndata: {"value":2}\n\n']);
      try {
        await withStubbedFetch(() => fixture.response, async (sent) => {
          expect(await collect(await start())).toEqual([{ value: 1 }]);
          expect(fixture.cancel).toHaveBeenCalledTimes(1);
          expect(fixture.response.body!.locked).toBe(false);
          expect(sent.init?.signal?.aborted).toBe(true);
        });
      } finally {
        fixture.close();
      }
    });

    it('cancels the response when the consumer breaks early', async () => {
      const fixture = trackedResponse(['data: {"value":1}\n\n']);
      try {
        await withStubbedFetch(() => fixture.response, async (sent) => {
          for await (const event of await start()) {
            expect(event).toEqual({ value: 1 });
            break;
          }
          expect(fixture.cancel).toHaveBeenCalledTimes(1);
          expect(fixture.response.body!.locked).toBe(false);
          expect(sent.init?.signal?.aborted).toBe(true);
        });
      } finally {
        fixture.close();
      }
    });

    it('cancels once when an active generator is explicitly returned', async () => {
      const fixture = trackedResponse(['data: {"value":1}\n\n']);
      try {
        await withStubbedFetch(() => fixture.response, async () => {
          const stream = await start();
          expect((await stream.next()).value).toEqual({ value: 1 });
          expect((await stream.return(undefined)).done).toBe(true);
          expect((await stream.return(undefined)).done).toBe(true);
          expect(fixture.cancel).toHaveBeenCalledTimes(1);
          expect(fixture.response.body!.locked).toBe(false);
        });
      } finally {
        fixture.close();
      }
    });

    it('preserves the JSON parse error even when cancellation rejects', async () => {
      const fixture = trackedResponse(['data: invalid-json\n\n'], { cancelError: new Error('cancel failed') });
      try {
        await withStubbedFetch(() => fixture.response, async () => {
          await expect((await start()).next()).rejects.toMatchObject({
            name: 'SDKError',
            message: expect.stringContaining('Failed to parse stream chunk:'),
          });
          expect(fixture.cancel).toHaveBeenCalledTimes(1);
          expect(fixture.response.body!.locked).toBe(false);
        });
      } finally {
        fixture.close();
      }
    });

    it('does not surface cancellation errors after [DONE]', async () => {
      const fixture = trackedResponse(['data: [DONE]\n\n'], { cancelError: new Error('cancel failed') });
      try {
        await withStubbedFetch(() => fixture.response, async () => {
          expect(await collect(await start())).toEqual([]);
          expect(fixture.cancel).toHaveBeenCalledTimes(1);
        });
      } finally {
        fixture.close();
      }
    });

    it('preserves split CRLF events and completes normally at EOF', async () => {
      const fixture = trackedResponse(['data:\r\n\r\ndata: {"value":', '1}\r', '\n\r\n'], { eof: true });
      await withStubbedFetch(() => fixture.response, async (sent) => {
        expect(await collect(await start())).toEqual([{ value: 1 }]);
        expect(fixture.cancel).not.toHaveBeenCalled();
        expect(fixture.response.body!.locked).toBe(false);
        expect(sent.init?.signal?.aborted).toBe(false);
      });
    });

    it('preserves an underlying read error and releases the reader', async () => {
      const fixture = trackedResponse(['data: {"value":1}\n\n']);
      const failure = new Error('read failed');
      try {
        await withStubbedFetch(() => fixture.response, async () => {
          const stream = await start();
          expect((await stream.next()).value).toEqual({ value: 1 });
          fixture.fail(failure);
          await expect(stream.next()).rejects.toBe(failure);
          expect(fixture.response.body!.locked).toBe(false);
          expect(fixture.cancel).not.toHaveBeenCalled();
        });
      } finally {
        fixture.close();
      }
    });

    it('does not request a response when returned before iteration starts', async () => {
      const respond = mock(() => new Response(null));
      await withStubbedFetch(respond, async () => {
        const stream = await start();
        expect((await stream.return(undefined)).done).toBe(true);
        expect(respond).not.toHaveBeenCalled();
      });
    });
  });
}

describe('stream ownership controls', () => {
  it('leaves a standalone parser response readable when the consumer stops', async () => {
    const fixture = trackedResponse(['data: first\n\n', 'data: second\n\n']);
    try {
      const parser = parseSSE(fixture.response);
      expect((await parser.next()).value?.data).toBe('first');
      await parser.return(undefined);
      expect(fixture.cancel).not.toHaveBeenCalled();
      expect(fixture.response.body!.locked).toBe(false);
      const reader = fixture.response.body!.getReader();
      try {
        expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: second\n\n');
      } finally {
        reader.releaseLock();
      }
    } finally {
      fixture.close();
    }
  });

  for (const stop of ['finish', 'break', 'return'] as const) {
    it(`keeps transcription cancellation exactly once on ${stop}`, async () => {
      const fixture = trackedResponse(['data: {"index":0,"delta":"first","finish":true}\n\n']);
      try {
        await withStubbedFetch(() => fixture.response, async () => {
          const stream = await sdk.speech.transcribe({ file: new Blob(['audio']), stream: true });
          if (stop === 'finish') {
            expect(await collect(stream)).toEqual([{ index: 0, delta: 'first', finish: true }]);
          } else if (stop === 'break') {
            for await (const event of stream) {
              expect(event.delta).toBe('first');
              break;
            }
          } else {
            expect((await stream.next()).value?.delta).toBe('first');
            await stream.return(undefined);
          }
          expect(fixture.cancel).toHaveBeenCalledTimes(1);
          expect(fixture.response.body!.locked).toBe(false);
        });
      } finally {
        fixture.close();
      }
    });
  }
});
