import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { request, requestJson } from '../../client/http';
import { musicEndpoint } from '../../client/endpoints';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import { saveAudioOutput } from '../../output/audio';
import { readTextFromPathOrStdin } from '../../utils/fs';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { MusicRequest, MusicResponse } from '../../types/api';

export default defineCommand({
  name: 'music generate',
  description: 'Generate a song (music-2.5)',
  usage: 'minimax music generate --prompt <text> [--lyrics <text>] [--out <path>] [flags]',
  options: [
    { flag: '--prompt <text>', description: 'Music style description' },
    { flag: '--lyrics <text>', description: 'Song lyrics' },
    { flag: '--lyrics-file <path>', description: 'Read lyrics from file (use - for stdin)' },
    { flag: '--format <fmt>', description: 'Audio format (default: mp3)' },
    { flag: '--sample-rate <hz>', description: 'Sample rate (default: 44100)', type: 'number' },
    { flag: '--bitrate <bps>',    description: 'Bitrate (default: 256000)', type: 'number' },
    { flag: '--stream', description: 'Stream raw audio to stdout' },
    { flag: '--out <path>', description: 'Save audio to file (uses hex decoding)' },
  ],
  examples: [
    'minimax music generate --prompt "Upbeat pop" --lyrics "La la la..."',
    'minimax music generate --prompt "Indie folk, melancholic" --lyrics-file song.txt --out my_song.mp3',
    'minimax music generate --prompt "Upbeat pop" --lyrics "La la la..." --out summer.mp3',
  ],
  async run(config: Config, flags: GlobalFlags) {
    const prompt = flags.prompt as string | undefined;
    let lyrics = flags.lyrics as string | undefined;

    if (flags.lyricsFile) {
      lyrics = readTextFromPathOrStdin(flags.lyricsFile as string);
    }

    if (!prompt && !lyrics) {
      throw new CLIError(
        'At least one of --prompt or --lyrics is required.',
        ExitCode.USAGE,
        'minimax music generate --prompt <text> [--lyrics <text>]',
      );
    }

    if (!lyrics) {
      process.stderr.write('Warning: No lyrics provided. Use --lyrics or --lyrics-file to include lyrics.\n');
    }

    const outPath = flags.out as string | undefined;
    const outFormat = outPath ? 'hex' : 'url';
    const format = detectOutputFormat(config.output);

    const body: MusicRequest = {
      model: 'music-2.5',
      prompt,
      lyrics,
      audio_setting: {
        format: (flags.format as string) || 'mp3',
        sample_rate: (flags.sampleRate as number) || 44100,
        bitrate: (flags.bitrate as number) || 256000,
      },
      output_format: outFormat,
      stream: flags.stream === true,
    };

    if (config.dryRun) {
      console.log(formatOutput({ request: body }, format));
      return;
    }

    const url = musicEndpoint(config.baseUrl);

    if (flags.stream) {
      const res = await request(config, { url, method: 'POST', body, stream: true });
      const reader = res.body?.getReader();
      if (!reader) throw new CLIError('No response body', ExitCode.GENERAL);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        process.stdout.write(value);
      }
      reader.releaseLock();
      return;
    }

    const response = await requestJson<MusicResponse>(config, {
      url,
      method: 'POST',
      body,
    });

    if (!config.quiet) process.stderr.write('[Model: music-2.5]\n');
    saveAudioOutput(response, outPath, format, config.quiet);
  },
});
