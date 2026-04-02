import { writeFileSync } from 'fs';
import type { OutputFormat } from './formatter';
import { formatOutput } from './formatter';

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
    writeFileSync(outPath, Buffer.from(response.data.audio!, 'hex'));
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
