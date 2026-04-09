/**
 * Helpers for piping streamed TTS / music responses to stdout as raw audio.
 *
 * The MiniMax streaming endpoints return a Server-Sent Events stream of JSON
 * envelopes whose `data.audio` field is a hex-encoded chunk of the target
 * audio format. The `--stream` CLI flag is documented as writing *raw audio*
 * to stdout (so it can be piped directly into players such as `mpv -`), so
 * this helper consumes the SSE stream, decodes the hex payloads, and writes
 * the decoded bytes to stdout.
 *
 * The stream contains N incremental chunk events followed by a terminal
 * "summary" event that re-sends the full audio plus metadata (this is what
 * `--out` saves). The summary must be skipped in streaming mode, otherwise
 * the complete file gets appended after the incremental frames and the
 * resulting MP3 contains duplicated audio with broken framing. The summary
 * is identified by the presence of a top-level `extra_info` field — note
 * that `trace_id` is on every event, so it cannot be used as the
 * discriminator.
 */

import { parseSSE } from '../client/stream';

/** Thrown when the upstream response has no body to stream from. */
export class NoResponseBodyError extends Error {
  constructor() {
    super('No response body');
    this.name = 'NoResponseBodyError';
  }
}

interface SseEnvelope {
  data?: { audio?: string; status?: number };
  extra_info?: unknown;
  trace_id?: string;
}

let stdoutEpipeHandlerInstalled = false;

/**
 * Install (idempotently) an EPIPE handler on stdout so that downstream
 * consumers closing the pipe early (e.g. `... | head`, or a player that
 * exits) cause a clean exit instead of an unhandled `'error'` event.
 */
export function installStdoutEpipeHandler(): void {
  if (stdoutEpipeHandlerInstalled) return;
  stdoutEpipeHandlerInstalled = true;
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err && err.code === 'EPIPE') {
      process.exit(0);
    }
    throw err;
  });
}

/**
 * Consume a fetch-style SSE response and write the decoded raw audio bytes
 * (from `data.audio` hex fields) to stdout, honoring backpressure.
 *
 * @throws {NoResponseBodyError} if `response.body` is missing.
 */
export async function pipeAudioSseToStdout(response: Response): Promise<void> {
  if (!response.body) {
    throw new NoResponseBodyError();
  }

  installStdoutEpipeHandler();

  for await (const event of parseSSE(response)) {
    const payload = event.data;
    if (!payload || payload === '[DONE]') continue;

    let parsed: SseEnvelope;
    try {
      parsed = JSON.parse(payload) as SseEnvelope;
    } catch {
      // Non-JSON keepalive — skip.
      continue;
    }

    // Skip the terminal summary event (it re-sends the entire audio).
    if (parsed.extra_info !== undefined) continue;

    const hex = parsed.data?.audio;
    if (typeof hex !== 'string' || hex.length === 0) continue;

    const chunk = Buffer.from(hex, 'hex');
    if (!process.stdout.write(chunk)) {
      // Honor backpressure: pause until stdout drains.
      await new Promise<void>((resolve) => process.stdout.once('drain', resolve));
    }
  }
}
