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
    { flag: '--prompt <text>', description: 'Music style description (can be detailed — see examples)' },
    { flag: '--lyrics <text>', description: 'Song lyrics with structure tags: [verse], [chorus], [bridge], etc.' },
    { flag: '--lyrics-file <path>', description: 'Read lyrics from file (use - for stdin)' },
    { flag: '--vocals <text>', description: 'Vocal style, e.g. "warm male and bright female duet"' },
    { flag: '--genre <text>', description: 'Music genre, e.g. folk, pop, jazz' },
    { flag: '--mood <text>', description: 'Mood or emotion, e.g. warm, melancholic, uplifting' },
    { flag: '--instruments <text>', description: 'Instruments to feature, e.g. "acoustic guitar, piano"' },
    { flag: '--bpm <number>', description: 'Tempo in beats per minute', type: 'number' },
    { flag: '--avoid <text>', description: 'Elements to avoid in the generated music' },
    { flag: '--extra <text>', description: 'Additional requirements, e.g. "bridge builds tension, chorus has layered harmonies"' },
    { flag: '--format <fmt>', description: 'Audio format (default: mp3)' },
    { flag: '--sample-rate <hz>', description: 'Sample rate (default: 44100)', type: 'number' },
    { flag: '--bitrate <bps>',    description: 'Bitrate (default: 256000)', type: 'number' },
    { flag: '--stream', description: 'Stream raw audio to stdout' },
    { flag: '--out <path>', description: 'Save audio to file (uses hex decoding)' },
  ],
  examples: [
    'minimax music generate --prompt "Upbeat pop" --lyrics "La la la..." --out summer.mp3',
    'minimax music generate --prompt "Indie folk, melancholic" --lyrics-file song.txt --out my_song.mp3',
    '# Detailed prompt with vocal characteristics — music-2.5 responds well to rich descriptions:',
    'minimax music generate --prompt "Warm morning folk" --vocals "male and female duet, harmonies in chorus" --instruments "acoustic guitar, piano" --bpm 95 --lyrics-file song.txt --out duet.mp3',
    '# Instrumental (use empty-structure lyrics + pure music prompt):',
    'minimax music generate --prompt "Cinematic orchestral, building tension" --lyrics "[intro] [outro]" --avoid "vocals, lyrics" --out bgm.mp3',
  ],
  async run(config: Config, flags: GlobalFlags) {
    let prompt = flags.prompt as string | undefined;
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

    // Build structured prompt from optional music characteristic flags.
    // music-2.5 interprets rich natural-language prompts — these flags make it
    // easy to describe vocal style, genre, mood, and instrumentation without
    // needing to hand-craft a long --prompt string.
    const structuredParts: string[] = [];
    if (flags.vocals)      structuredParts.push(`Vocals: ${flags.vocals as string}`);
    if (flags.genre)       structuredParts.push(`Genre: ${flags.genre as string}`);
    if (flags.mood)        structuredParts.push(`Mood: ${flags.mood as string}`);
    if (flags.instruments) structuredParts.push(`Instruments: ${flags.instruments as string}`);
    if (flags.bpm)         structuredParts.push(`BPM: ${flags.bpm as number}`);
    if (flags.avoid)       structuredParts.push(`Avoid: ${flags.avoid as string}`);
    if (flags.extra)       structuredParts.push(`Extra: ${flags.extra as string}`);

    if (structuredParts.length > 0) {
      const structured = structuredParts.join('. ');
      prompt = prompt ? `${prompt}. ${structured}` : structured;
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
