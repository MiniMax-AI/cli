import { writeFileSync } from 'fs';
import type { OutputFormat } from './formatter';
import { formatOutput } from './formatter';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';

interface AudioExtraInfo {
  audio_length?: number;
  audio_size?: number;
  audio_sample_rate?: number;
}

interface AudioResponse {
  data: { audio?: string; audio_url?: string };
  extra_info?: AudioExtraInfo;
}

export function saveAudioOutput(
  response: AudioResponse,
  outPath: string | undefined,
  format: OutputFormat,
  quiet: boolean,
): void {
  if (outPath) {
    const audioHex = response.data.audio;
    if (!audioHex) {
      throw new CLIError(
        'API response missing audio data (audio field is empty).',
        ExitCode.GENERAL,
      );
    }
    // Validate hex string before attempting conversion
    if (!/^[0-9a-fA-F]*$/.test(audioHex)) {
      throw new CLIError(
        'API returned invalid audio data (not valid hex).',
        ExitCode.GENERAL,
      );
    }
    if (audioHex.length % 2 !== 0) {
      throw new CLIError(
        'API returned truncated audio data (odd-length hex string).',
        ExitCode.GENERAL,
      );
    }
    try {
      writeFileSync(outPath, Buffer.from(audioHex, 'hex'));
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOSPC') {
        throw new CLIError(
          'Disk full — cannot write audio file.',
          ExitCode.GENERAL,
          'Free up disk space and try again.',
        );
      }
      throw err;
    }
    if (quiet) {
      console.log(outPath);
    } else {
      console.log(formatOutput({
        saved: outPath,
        duration_ms: response.extra_info?.audio_length,
        size_bytes: response.extra_info?.audio_size,
        sample_rate: response.extra_info?.audio_sample_rate,
      }, format));
    }
  } else {
    const audioUrl = response.data.audio_url ?? response.data.audio;
    if (quiet) {
      console.log(audioUrl);
    } else {
      console.log(formatOutput({
        url: audioUrl,
        duration_ms: response.extra_info?.audio_length,
        size_bytes: response.extra_info?.audio_size,
      }, format));
    }
  }
}
