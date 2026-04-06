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
    { flag: '--lyrics <text>', description: 'Song lyrics with structure tags. Use "无歌词" for instrumental music. Cannot be used with --instrumental.' },
    { flag: '--lyrics-file <path>', description: 'Read lyrics from file. Use "无歌词" for instrumental. (use - for stdin)' },
    { flag: '--vocals <text>', description: 'Vocal style, e.g. "warm male and bright female duet"' },
    { flag: '--genre <text>', description: 'Music genre, e.g. folk, pop, jazz' },
    { flag: '--mood <text>', description: 'Mood or emotion, e.g. warm, melancholic, uplifting' },
    { flag: '--instruments <text>', description: 'Instruments to feature, e.g. "acoustic guitar, piano"' },
    { flag: '--tempo <text>', description: 'Tempo description, e.g. fast, slow, moderate' },
    { flag: '--bpm <number>', description: 'Exact tempo in beats per minute', type: 'number' },
    { flag: '--key <text>', description: 'Musical key, e.g. C major, A minor, G sharp' },
    { flag: '--avoid <text>', description: 'Elements to avoid in the generated music' },
    { flag: '--use-case <text>', description: 'Use case context, e.g. "background music for video", "theme song"' },
    { flag: '--structure <text>', description: 'Song structure, e.g. "verse-chorus-verse-bridge-chorus"' },
    { flag: '--references <text>', description: 'Reference tracks or artists, e.g. "similar to Ed Sheeran, Taylor Swift"' },
    { flag: '--extra <text>', description: 'Additional fine-grained requirements not covered above' },
    { flag: '--instrumental', description: 'Generate instrumental music (no vocals)' },
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
    '# Instrumental (use --instrumental flag):',
    'minimax music generate --prompt "Cinematic orchestral, building tension" --instrumental --out bgm.mp3',
    '# Or specify "无歌词" in lyrics:',
    'minimax music generate --prompt "Cinematic orchestral" --lyrics "无歌词" --out bgm.mp3',
  ],
  async run(config: Config, flags: GlobalFlags) {
    let prompt = flags.prompt as string | undefined;
    let lyrics = flags.lyrics as string | undefined;

    if (flags.lyricsFile) {
      lyrics = readTextFromPathOrStdin(flags.lyricsFile as string);
    }

    // Check for conflicting flags: --instrumental and --lyrics/--lyrics-file
    if (flags.instrumental && (lyrics || flags.lyricsFile)) {
      throw new CLIError(
        'Cannot use --instrumental with --lyrics or --lyrics-file. For instrumental music, simply use --instrumental without --lyrics.',
        ExitCode.USAGE,
        'minimax music generate --prompt <style> --instrumental',
      );
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
    if (flags.tempo)       structuredParts.push(`Tempo: ${flags.tempo as string}`);
    if (flags.bpm)         structuredParts.push(`BPM: ${flags.bpm as number}`);
    if (flags.key)         structuredParts.push(`Key: ${flags.key as string}`);
    if (flags.avoid)       structuredParts.push(`Avoid: ${flags.avoid as string}`);
    if (flags.useCase)     structuredParts.push(`Use case: ${flags.useCase as string}`);
    if (flags.structure)   structuredParts.push(`Structure: ${flags.structure as string}`);
    if (flags.references)  structuredParts.push(`References: ${flags.references as string}`);
    if (flags.extra)       structuredParts.push(`Extra: ${flags.extra as string}`);

    // Handle "无歌词" as instrumental request
    if (lyrics === '无歌词' || lyrics === 'no lyrics') {
      lyrics = '[intro] [outro]';
      structuredParts.push('Style: instrumental, no vocals, pure music');
    }

    // Handle --instrumental: music-2.5 has no is_instrumental flag,
    // so we use the empty-structure lyrics workaround.
    if (flags.instrumental) {
      lyrics = '[intro] [outro]';
      structuredParts.push('Style: instrumental, no vocals, pure music');
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
