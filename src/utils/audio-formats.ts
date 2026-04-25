import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';

/**
 * Valid audio output formats supported by MiniMax TTS and music generation APIs.
 *
 * @see https://platform.minimax.io/docs/api-reference/speech-t2a-http
 * @see https://github.com/MiniMax-AI/cli/issues/111
 */
export const AUDIO_FORMATS = ['mp3', 'wav', 'flac', 'pcm'] as const;

export type AudioFormat = (typeof AUDIO_FORMATS)[number];

/** Human-readable list for error messages and help text. */
export const AUDIO_FORMATS_DISPLAY = AUDIO_FORMATS.join(', ');

/**
 * Validate that a given format string is a supported audio format.
 * Returns the format if valid, throws a descriptive error if not.
 */
export function validateAudioFormat(format: string): AudioFormat {
  if (!(AUDIO_FORMATS as readonly string[]).includes(format)) {
    throw new CLIError(
      `Invalid audio format "${format}". Supported formats: ${AUDIO_FORMATS_DISPLAY}`,
      ExitCode.USAGE,
      `Use one of: ${AUDIO_FORMATS_DISPLAY}`,
    );
  }
  return format as AudioFormat;
}
