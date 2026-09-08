import { describe, it, expect, afterEach } from 'bun:test';
import { MiniMaxSDK } from '../../src/sdk';

interface WsTtsServer {
  url: string;
  close(): void;
}

/**
 * Minimal mock of the T2A WebSocket protocol: acknowledges the connection,
 * acknowledges task_start, returns one hex audio chunk for task_continue,
 * and emits task_finished before closing on task_finish.
 */
function createWsTtsServer(): WsTtsServer {
  const server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      if (srv.upgrade(req)) return undefined;
      return new Response('upgrade failed', { status: 500 });
    },
    websocket: {
      open(ws) {
        ws.send(JSON.stringify({
          event: 'connected_success',
          base_resp: { status_code: 0, status_msg: 'success' },
        }));
      },
      message(ws, message) {
        const parsed = JSON.parse(String(message)) as { event?: string };
        if (parsed.event === 'task_start') {
          ws.send(JSON.stringify({
            event: 'task_started',
            base_resp: { status_code: 0, status_msg: 'success' },
          }));
        } else if (parsed.event === 'task_continue') {
          ws.send(JSON.stringify({
            data: { audio: '414243' },
            is_final: true,
            base_resp: { status_code: 0, status_msg: 'success' },
          }));
          ws.send(JSON.stringify({
            event: 'task_finished',
            base_resp: { status_code: 0, status_msg: 'success' },
          }));
        } else if (parsed.event === 'task_finish') {
          ws.close();
        }
      },
      close() {},
    },
  });

  return {
    url: `ws://localhost:${server.port}`,
    close() { server.stop(); },
  };
}

describe('MiniMaxSDK.speech.synthesizeWebSocket', () => {
  let server: WsTtsServer;

  afterEach(() => {
    server?.close();
  });

  it('collects hex audio chunks into a buffer', async () => {
    server = createWsTtsServer();

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url.replace(/^ws/, 'http'),
    });

    const audio = await sdk.speech.synthesizeWebSocket({
      model: 'speech-2.8-hd',
      text: 'Hello world',
    });

    expect(Buffer.isBuffer(audio)).toBe(true);
    expect(audio.toString()).toBe('ABC');
  });

  it('streams audio chunks as an async generator', async () => {
    server = createWsTtsServer();

    const sdk = new MiniMaxSDK({
      apiKey: 'test-key',
      baseUrl: server.url.replace(/^ws/, 'http'),
    });

    const stream = await sdk.speech.synthesizeWebSocket({
      model: 'speech-2.8-hd',
      text: 'Hello world',
      stream: true,
    });

    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('ABC');
  });
});
