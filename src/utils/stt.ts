import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import type { SpeechToTextFormat } from '../types/api';

/** The only model `POST /v1/speech_to_text` exposes today. */
export const STT_DEFAULT_MODEL = 'asr-1.0';

/** `response_format` values accepted by the API. */
export const STT_RESPONSE_FORMATS: readonly SpeechToTextFormat[] = [
  'json',
  'verbose_json',
  'srt',
  'vtt',
];

/**
 * Documented upload limit for speech-to-text. Checked before the request so an
 * oversized file fails locally instead of being uploaded only to come back as
 * HTTP 413 — an uncompressed 500 s 48 kHz stereo WAV is ~92 MB.
 */
export const STT_MAX_FILE_BYTES = 50 * 1024 * 1024;

export function validateSttFileSize(filePath: string, sizeBytes: number): void {
  if (sizeBytes > STT_MAX_FILE_BYTES) {
    throw new CLIError(
      `Audio file is ${(sizeBytes / 1024 / 1024).toFixed(1)} MB; speech-to-text allows at most ${STT_MAX_FILE_BYTES / 1024 / 1024} MB: ${filePath}`,
      ExitCode.USAGE,
      'Re-encode to compressed mono audio (e.g. mp3 / aac) or split it into smaller files.',
    );
  }
}

/**
 * `stream=true` is only accepted together with `response_format=json`, so the
 * combination is rejected before the audio is uploaded. Returns the message
 * instead of throwing so the CLI and SDK can each raise their own error type.
 */
export function sttStreamFormatConflict(responseFormat: string, stream: boolean): string | undefined {
  if (!stream || responseFormat === 'json') return undefined;
  return `response_format "${responseFormat}" cannot be combined with stream=true; streaming returns incremental json only.`;
}
