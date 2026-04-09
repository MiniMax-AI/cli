/**
 * Helpers for piping streamed TTS / music responses to stdout as raw audio.
 *
 * The MiniMax streaming endpoints return a Server-Sent Events stream of JSON
 * envelopes whose `data.audio` field is a hex-encoded chunk of the target
 * audio format. The `--stream` CLI flag is documented as writing *raw audio*
 * to stdout (so it can be piped directly into players such as `mpv -`), so
 * this helper parses the SSE frames, decodes the hex payloads, and writes
 * the decoded bytes to stdout.
 */

/**
 * Install a one-shot EPIPE handler on stdout so that downstream consumers
 * closing the pipe early (e.g. `... | head`, or a player that exits) does
 * not crash the process with an unhandled `'error'` event.
 */
export function installStdoutEpipeHandler(): void {
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err && err.code === 'EPIPE') {
      process.exit(0);
    }
    throw err;
  });
}

/**
 * Consume a fetch-style ReadableStream of SSE bytes and write the decoded
 * raw audio bytes (from `data.audio` hex fields) to stdout.
 */
export async function pipeAudioSseToStdout(
  body: ReadableStream<Uint8Array> | null | undefined,
): Promise<void> {
  const reader = body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  installStdoutEpipeHandler();

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by blank lines.
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        writeEvent(event);
      }
    }

    // Flush any trailing event without a terminating blank line.
    buffer += decoder.decode();
    if (buffer.length > 0) {
      writeEvent(buffer);
    }
  } finally {
    reader.releaseLock();
  }
}

interface SseEnvelope {
  data?: { audio?: string; status?: number };
  // `extra_info` is only present on the terminal "summary" event, which
  // re-sends the full audio plus metadata. We must skip that event in
  // streaming mode, otherwise the complete file gets appended after the
  // incremental frames and the resulting MP3 contains duplicated audio
  // with broken framing. (Note: every event carries `trace_id`, so it
  // can't be used as the discriminator.)
  extra_info?: unknown;
  trace_id?: string;
}

function writeEvent(event: string): void {
  for (const rawLine of event.split('\n')) {
    if (!rawLine.startsWith('data:')) continue;
    // Per SSE spec, an optional single space after `data:` should be stripped.
    const payload = rawLine.slice(5).replace(/^ /, '');
    if (!payload || payload === '[DONE]') continue;

    let parsed: SseEnvelope;
    try {
      parsed = JSON.parse(payload) as SseEnvelope;
    } catch {
      // Non-JSON keepalive or comment — skip.
      continue;
    }

    // Skip the terminal summary event (it re-sends the entire audio).
    if (parsed.extra_info !== undefined) {
      continue;
    }

    const hex = parsed?.data?.audio;
    if (typeof hex === 'string' && hex.length > 0) {
      process.stdout.write(Buffer.from(hex, 'hex'));
    }
  }
}
