import { parseSSE } from '../client/stream';
import { mapApiError, type ApiErrorBody } from '../errors/api';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';

interface AudioPayload extends ApiErrorBody {
  data?: { audio?: string; status?: number };
}

function decodeHexAudio(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new CLIError(
      'API returned invalid audio data (not valid hex).',
      ExitCode.GENERAL,
    );
  }
  if (hex.length % 2 !== 0) {
    throw new CLIError(
      'API returned truncated audio data (odd-length hex string).',
      ExitCode.GENERAL,
    );
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

function throwIfApiError(response: Response, payload: AudioPayload): void {
  const statusCode = payload.base_resp?.status_code;
  if ((statusCode !== undefined && statusCode !== 0) || payload.error) {
    throw mapApiError(response.status, payload, response.url || undefined);
  }
}

function missingAudioError(): CLIError {
  return new CLIError(
    'API stream ended without audio data.',
    ExitCode.GENERAL,
  );
}

export async function* decodeAudioStream(
  response: Response,
): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/event-stream')) {
    let payload: AudioPayload;
    try {
      payload = await response.json() as AudioPayload;
    } catch {
      throw new CLIError(
        `Expected SSE audio stream but got content-type "${contentType || 'unknown'}".`,
        ExitCode.GENERAL,
      );
    }

    throwIfApiError(response, payload);

    const hex = payload.data?.audio;
    if (!hex) throw missingAudioError();
    yield decodeHexAudio(hex);
    return;
  }

  let receivedAudio = false;
  for await (const event of parseSSE(response)) {
    if (!event.data || event.data === '[DONE]') break;

    let parsed: AudioPayload;
    try {
      parsed = JSON.parse(event.data) as AudioPayload;
    } catch (error) {
      throw new CLIError(
        `Failed to parse audio stream chunk: ${error instanceof Error ? error.message : String(error)}`,
        ExitCode.GENERAL,
      );
    }

    throwIfApiError(response, parsed);

    const hex = parsed.data?.audio;
    if (hex) {
      receivedAudio = true;
      yield decodeHexAudio(hex);
    }

    if (parsed.data?.status === 2) break;
  }

  if (!receivedAudio) throw missingAudioError();
}

export async function pipeAudioStream(response: Response): Promise<void> {
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(0);
    throw err;
  });

  for await (const chunk of decodeAudioStream(response)) {
    if (!process.stdout.write(chunk)) {
      await new Promise<void>(r => process.stdout.once('drain', r));
    }
  }
}
