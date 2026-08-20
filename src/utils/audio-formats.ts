import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';

export const T2A_FORMATS = ['mp3', 'pcm', 'flac', 'wav', 'pcmu_raw', 'pcmu_wav', 'opus'] as const;
export type T2AFormat = (typeof T2A_FORMATS)[number];

export function formatList(formats: readonly string[]): string {
  return formats.join(', ');
}

export function validateAudioFormat(format: string, formats: readonly string[]): void {
  if (!(formats as readonly string[]).includes(format)) {
    throw new CLIError(
      `Invalid audio format "${format}". Supported: ${formatList(formats)}`,
      ExitCode.USAGE,
    );
  }
}

const T2A_SAMPLE_RATE: Partial<Record<T2AFormat, number>> = {
  opus: 24000,
  pcmu_raw: 8000,
  pcmu_wav: 8000,
};

export function t2aDefaultSampleRate(format: string, fallback: number): number {
  return T2A_SAMPLE_RATE[format as T2AFormat] ?? fallback;
}

export function validateT2AStreaming(format: string, stream: boolean): void {
  if (stream && format === 'wav') {
    throw new CLIError(
      'wav format is not supported in streaming mode.',
      ExitCode.USAGE,
      'Use mp3, pcm, flac, pcmu_raw, pcmu_wav, or opus for streaming.',
    );
  }
}
