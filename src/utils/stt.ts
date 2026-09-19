import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import { formatList } from './audio-formats';
import type { SpeechToTextFormat, SpeechToTextTimestampLevel } from '../types/api';

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

export function validateSttResponseFormat(format: string): void {
  if (!(STT_RESPONSE_FORMATS as readonly string[]).includes(format)) {
    throw new CLIError(
      `Invalid response format "${format}". Supported: ${formatList(STT_RESPONSE_FORMATS)}`,
      ExitCode.USAGE,
    );
  }
}

/**
 * `stream=true` is only accepted together with `response_format=json`, so the
 * combination is rejected before the audio is uploaded.
 */
export function validateSttStreaming(responseFormat: string, stream: boolean): void {
  if (stream && responseFormat !== STT_STREAM_FORMAT) {
    throw new CLIError(
      `response_format "${responseFormat}" cannot be combined with stream=true; streaming returns incremental json only.`,
      ExitCode.USAGE,
    );
  }
}

export function validateSttFileSize(filePath: string, sizeBytes: number): void {
  if (sizeBytes > STT_MAX_FILE_BYTES) {
    throw new CLIError(
      `Audio file is ${(sizeBytes / 1024 / 1024).toFixed(1)} MB; speech-to-text allows at most ${STT_MAX_FILE_BYTES / 1024 / 1024} MB: ${filePath}`,
      ExitCode.USAGE,
      'Re-encode to compressed mono audio (e.g. mp3 / aac) or split it into smaller files.',
    );
  }
}
