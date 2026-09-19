import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import { request, requestJson } from '../client/http';
import type { Config } from '../config/schema';
import type { SpeechToTextFormat, SpeechToTextResponse, SpeechToTextTimestampLevel } from '../types/api';

/**
 * The validators raise the caller's error class: the CLI passes nothing
 * (defaults to `CLIError`), the SDK passes `SDKError` so consumers narrowing on
 * it do not miss these.
 */
export type SttErrorCtor = new (message: string, exitCode: ExitCode, hint?: string) => CLIError;

/** The only model `POST /v1/speech_to_text` exposes today. */
export const STT_DEFAULT_MODEL = 'asr-1.0';

/** `response_format` values accepted by the API. */
export const STT_RESPONSE_FORMATS: readonly SpeechToTextFormat[] = [
  'json',
  'verbose_json',
  'srt',
  'vtt',
];

/** Formats the API returns as subtitle documents rather than as JSON. */
export const STT_SUBTITLE_FORMATS: readonly SpeechToTextFormat[] = ['srt', 'vtt'];

/** `stream=true` carries incremental json only. */
export const STT_STREAM_FORMAT: SpeechToTextFormat = 'json';

/**
 * Documented upload limit. Checked before the request so an oversized file
 * fails locally instead of being uploaded only to come back as HTTP 413 — an
 * uncompressed 500 s 48 kHz stereo WAV is ~92 MB.
 */
export const STT_MAX_FILE_BYTES = 50 * 1024 * 1024;

/** The text parts of the multipart request; the audio travels as `file`. */
export interface SttFields {
  model?: string;
  response_format?: SpeechToTextFormat;
  timestamp_level?: SpeechToTextTimestampLevel;
  stream?: boolean;
}

/** Whether a response format is returned as a subtitle document. */
export function isSubtitleFormat(format: string): boolean {
  return (STT_SUBTITLE_FORMATS as readonly string[]).includes(format);
}

/**
 * The multipart text parts, in the order the API documents them, so the CLI and
 * the SDK cannot drift over field names or encodings.
 */
export function sttFormFields({
  model,
  response_format,
  timestamp_level,
  stream,
}: SttFields): Record<string, string> {
  const fields: Record<string, string> = {
    model: model ?? STT_DEFAULT_MODEL,
    response_format: response_format ?? STT_STREAM_FORMAT,
  };
  if (timestamp_level) fields.timestamp_level = timestamp_level;
  if (stream) fields.stream = 'true';
  return fields;
}

export function validateSttResponseFormat(format: string, errorCtor: SttErrorCtor = CLIError): void {
  if (!(STT_RESPONSE_FORMATS as readonly string[]).includes(format)) {
    throw new errorCtor(
      `Invalid response format "${format}". Supported: ${STT_RESPONSE_FORMATS.join(', ')}`,
      ExitCode.USAGE,
    );
  }
}

/**
 * `stream=true` is only accepted together with `response_format=json`, so the
 * combination is rejected before the audio is uploaded.
 */
export function validateSttStreaming(
  responseFormat: string,
  stream: boolean,
  errorCtor: SttErrorCtor = CLIError,
): void {
  if (stream && responseFormat !== STT_STREAM_FORMAT) {
    throw new errorCtor(
      `response_format "${responseFormat}" cannot be combined with stream=true; streaming returns incremental json only.`,
      ExitCode.USAGE,
    );
  }
}

/** `source` is what the caller calls the audio: a path, or a Blob's filename. */
export function validateSttFileSize(
  source: string,
  sizeBytes: number,
  errorCtor: SttErrorCtor = CLIError,
): void {
  if (sizeBytes > STT_MAX_FILE_BYTES) {
    throw new errorCtor(
      `Audio file is ${(sizeBytes / 1024 / 1024).toFixed(1)} MB; speech-to-text allows at most ${STT_MAX_FILE_BYTES / 1024 / 1024} MB: ${source}`,
      ExitCode.USAGE,
      'Re-encode to compressed mono audio (e.g. mp3 / aac) or split it into smaller files.',
    );
  }
}

/** The result of submitting a transcription, split by how the API replies. */
export type SttSubmission =
  | { kind: 'stream'; res: Response }
  | { kind: 'subtitle'; document: string }
  | { kind: 'json'; response: SpeechToTextResponse };

export interface SttSubmissionOpts {
  config: Config;
  url: string;
  form: FormData;
  headers: Record<string, string>;
  /** Already validated by the caller; decides how the reply is read. */
  responseFormat: string;
  stream: boolean;
}

/**
 * Submit the multipart form once for the CLI and the SDK alike, so the
 * three-way response handling (SSE / subtitle document / JSON) cannot drift
 * between the two layers.
 */
export async function submitSttForm({
  config,
  url,
  form,
  headers,
  responseFormat,
  stream,
}: SttSubmissionOpts): Promise<SttSubmission> {
  if (stream) {
    const res = await request(config, { url, method: 'POST', body: form, headers, stream: true });
    return { kind: 'stream', res };
  }
  if (isSubtitleFormat(responseFormat)) {
    const res = await request(config, { url, method: 'POST', body: form, headers });
    return { kind: 'subtitle', document: await res.text() };
  }
  const response = await requestJson<SpeechToTextResponse>(config, {
    url,
    method: 'POST',
    body: form,
    headers,
  });
  return { kind: 'json', response };
}
