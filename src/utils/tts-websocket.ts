import { WebSocket } from 'undici';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import type { SpeechRequest } from '../types/api';

/** Request payload for the synchronous T2A WebSocket protocol. */
export interface SpeechWebSocketRequest {
  model: string;
  text: string;
  voice_setting?: SpeechRequest['voice_setting'];
  audio_setting?: SpeechRequest['audio_setting'];
  language_boost?: string;
  pronunciation_dict?: SpeechRequest['pronunciation_dict'];
}

interface SpeechWsEvent {
  event?: string;
  data?: { audio?: string };
  is_final?: boolean;
  base_resp?: { status_code?: number; status_msg?: string };
}

function decodeHexAudio(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new CLIError(
      'Speech WebSocket returned invalid audio data (not valid hex).',
      ExitCode.GENERAL,
    );
  }
  if (hex.length % 2 !== 0) {
    throw new CLIError(
      'Speech WebSocket returned truncated audio data (odd-length hex string).',
      ExitCode.GENERAL,
    );
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

function wsError(event: SpeechWsEvent): Error | undefined {
  const code = event.base_resp?.status_code;
  if (code && code !== 0) {
    return new CLIError(
      `Speech WebSocket error (${code}): ${event.base_resp?.status_msg ?? 'unknown'}`,
      ExitCode.GENERAL,
    );
  }
  return undefined;
}

/** Minimal FIFO bridge from WebSocket events to sequential consumers. */
class WsReceiver {
  private queue: SpeechWsEvent[] = [];
  private waiters: Array<{
    resolve: (ev: SpeechWsEvent) => void;
    reject: (err: Error) => void;
  }> = [];
  private failure: Error | undefined;

  push(ev: SpeechWsEvent): void {
    if (this.failure) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(ev);
    else this.queue.push(ev);
  }

  fail(err: Error): void {
    this.failure = err;
    for (const waiter of this.waiters.splice(0)) waiter.reject(err);
  }

  next(): Promise<SpeechWsEvent> {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift()!);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<SpeechWsEvent>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }
}

/**
 * Stream audio chunks for synchronous TTS over WebSocket (`/ws/v1/t2a_v2`).
 *
 * The protocol sends a `task_start` message carrying the model and voice/audio
 * settings, then a `task_continue` message with the text to synthesize. Audio
 * arrives as hex-encoded chunks in `task_continued` events until `is_final`.
 */
export async function* ttsWebSocketAudioStream(
  url: string,
  token: string,
  request: SpeechWebSocketRequest,
): AsyncGenerator<Uint8Array> {
  const receiver = new WsReceiver();
  const ws = new WebSocket(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  ws.addEventListener('error', () => {
    receiver.fail(new CLIError('Speech WebSocket connection failed.', ExitCode.GENERAL));
  });

  ws.addEventListener('close', () => {
    receiver.fail(new CLIError('Speech WebSocket closed unexpectedly.', ExitCode.GENERAL));
  });

  ws.addEventListener('message', (event) => {
    const raw = (event as { data?: unknown }).data;
    let data: string;
    if (typeof raw === 'string') {
      data = raw;
    } else if (raw instanceof ArrayBuffer) {
      data = new TextDecoder().decode(raw);
    } else {
      receiver.fail(
        new CLIError('Speech WebSocket returned an unsupported message type.', ExitCode.GENERAL),
      );
      return;
    }

    let parsed: SpeechWsEvent;
    try {
      parsed = JSON.parse(data) as SpeechWsEvent;
    } catch {
      receiver.fail(new CLIError('Speech WebSocket returned a non-JSON message.', ExitCode.GENERAL));
      return;
    }
    receiver.push(parsed);
  });

  try {
    const connected = await receiver.next();
    if (connected.event !== 'connected_success') {
      throw wsError(connected)
        ?? new CLIError('Speech WebSocket did not acknowledge the connection.', ExitCode.GENERAL);
    }

    const start: Record<string, unknown> = { event: 'task_start', model: request.model };
    if (request.language_boost) start.language_boost = request.language_boost;
    if (request.voice_setting) start.voice_setting = request.voice_setting;
    if (request.pronunciation_dict) start.pronunciation_dict = request.pronunciation_dict;
    if (request.audio_setting) start.audio_setting = request.audio_setting;
    ws.send(JSON.stringify(start));

    const started = await receiver.next();
    if (started.event !== 'task_started') {
      throw wsError(started)
        ?? new CLIError('Speech WebSocket did not start the task.', ExitCode.GENERAL);
    }

    ws.send(JSON.stringify({ event: 'task_continue', text: request.text }));

    while (true) {
      const ev = await receiver.next();
      if (ev.event === 'task_failed' || ev.event === 'task_finished') {
        const err = wsError(ev);
        if (err) throw err;
        break;
      }
      const audio = ev.data?.audio;
      if (audio) {
        const err = wsError(ev);
        if (err) throw err;
        yield decodeHexAudio(audio);
      }
      if (ev.is_final) break;
    }
  } finally {
    try {
      ws.send(JSON.stringify({ event: 'task_finish' }));
    } catch { /* socket may already be closed */ }
    try {
      ws.close();
    } catch { /* already closed */ }
  }
}
