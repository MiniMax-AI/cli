import { describe, expect, it } from 'bun:test';
import { decodeAudioStream } from '../../src/utils/audio-stream';
import { jsonResponse, sseResponse } from '../helpers/mock-server';

async function collectAudio(response: Response): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of decodeAudioStream(response)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

describe('decodeAudioStream', () => {
  it('decodes a non-SSE JSON success response instead of returning empty audio', async () => {
    const audio = await collectAudio(jsonResponse({
      data: { audio: '414243', status: 2 },
      base_resp: { status_code: 0, status_msg: 'success' },
    }));

    expect(audio.toString()).toBe('ABC');
  });

  it('propagates API errors from SSE events', async () => {
    const response = sseResponse([{
      data: JSON.stringify({
        base_resp: { status_code: 1028, status_msg: 'quota exhausted' },
      }),
    }]);

    await expect(collectAudio(response)).rejects.toThrow('Quota exhausted');
  });

  it('rejects malformed SSE JSON', async () => {
    const response = sseResponse([{ data: '{not-json' }]);

    await expect(collectAudio(response)).rejects.toThrow(
      'Failed to parse audio stream chunk',
    );
  });

  it('rejects invalid audio hex', async () => {
    const response = sseResponse([{
      data: JSON.stringify({ data: { audio: 'not-hex', status: 1 } }),
    }]);

    await expect(collectAudio(response)).rejects.toThrow('not valid hex');
  });

  it('rejects a completed stream that contains no audio', async () => {
    const response = sseResponse([{
      data: JSON.stringify({ data: { status: 2 } }),
    }]);

    await expect(collectAudio(response)).rejects.toThrow(
      'API stream ended without audio data',
    );
  });

  it('rejects a stream that closes after audio chunks but without a terminator', async () => {
    // A dropped connection: chunks arrive, then the body ends with no
    // `status: 2` chunk and no `data: [DONE]` terminator.
    const response = new Response(
      'data: {"data":{"audio":"414243","status":1}}\n\n'
      + 'data: {"data":{"audio":"444546","status":1}}\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    );

    await expect(collectAudio(response)).rejects.toThrow(
      'Stream disconnected before audio completed.',
    );
  });
});
