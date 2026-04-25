import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { request, requestJson } from '../../client/http';
import { musicEndpoint } from '../../client/endpoints';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import { saveAudioOutput } from '../../output/audio';
import { readTextFromPathOrStdin } from '../../utils/fs';
import { AUDIO_FORMATS_DISPLAY, validateAudioFormat } from '../../utils/audio-formats';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { MusicRequest, MusicResponse } from '../../types/api';
import { musicGenerateModel } from './models';

export default defineCommand({
  name: 'music generate',
  description: 'Generate a song (music-2.6 / music-2.6-free / music-2.5+ / music-2.5)',
  apiDocs: '/docs/api-reference/music-generation',
  usage: 'mmx music generate --prompt <text> (--lyrics <text> | --instrumental | --lyrics-optimizer) [--out <path>] [flags]',
  options: [
    { flag: '--prompt <text>', description: 'Music style description (e.g. "cinematic orchestral, building tension"). Max 2000 chars when combined with structured flags.' },
    { flag: '--lyrics <text>', description: 'Song lyrics with structure tags (newline separated). Supported: [Intro], [Verse], [Pre Chorus], [Chorus], [Interlude], [Bridge], [Outro], [Post Chorus], [Transition], [Break], [Hook], [Build Up], [Inst], [Solo]. Tags must be clean — no descriptions inside brackets (they will be sung). Max 3500 chars.' },
    { flag: '--lyrics-file <path>', description: 'Read lyrics from file (use - for stdin). Same tag rules as --lyrics.' },
    { flag: '--lyrics-optimizer', description: 'Auto-generate lyrics from prompt (cannot be used with --lyrics or --instrumental)' },
    { flag: '--instrumental', description: 'Generate instrumental music (no vocals). music-2.6/music-2.5+: native is_instrumental flag; music-2.5: lyrics workaround. Cannot be used with --lyrics.' },
    { flag: '--vocals <text>', description: 'Vocal style, e.g. "warm male baritone", "bright female soprano", "duet with harmonies"' },
    { flag: '--genre <text>', description: 'Music genre, e.g. folk, pop, jazz, electronic' },
    { flag: '--mood <text>', description: 'Mood or emotion, e.g. warm, melancholic, uplifting' },
    { flag: '--instruments <text>', description: 'Instruments to feature, e.g. "acoustic guitar, piano, strings"' },
    { flag: '--tempo <text>', description: 'Tempo description, e.g. fast, slow, moderate' },
    { flag: '--bpm <number>', description: 'Exact tempo in beats per minute', type: 'number' },
    { flag: '--key <text>', description: 'Musical key, e.g. C major, A minor, G sharp' },
    { flag: '--avoid <text>', description: 'Elements to avoid in the generated music' },
    { flag: '--use-case <text>', description: 'Use case context, e.g. "background music for video", "theme song"' },
    { flag: '--structure <text>', description: 'Song structure, e.g. "verse-chorus-verse-bridge-chorus"' },
    { flag: '--references <text>', description: 'Reference tracks or artists, e.g. "similar to Ed Sheeran"' },
    { flag: '--extra <text>', description: 'Additional fine-grained requirements not covered above' },
    { flag: '--model <model>', description: 'Model: music-2.6 (recommended), music-2.6-free (default, unlimited), music-2.5+, or music-2.5.' },
    { flag: '--output-format <fmt>', description: 'Return format: hex (default, saved to file) or url (24h expiry, download promptly). When --stream, only hex.' },
    { flag: '--aigc-watermark', description: 'Embed AI-generated content watermark in audio for content provenance' },
    { flag: '--format <fmt>', description: `Audio format: ${AUDIO_FORMATS_DISPLAY} (default: mp3)` },
    { flag: '--sample-rate <hz>', description: 'Sample rate (default: 44100)', type: 'number' },
    { flag: '--bitrate <bps>',    description: 'Bitrate (default: 256000)', type: 'number' },
    { flag: '--stream', description: 'Stream raw audio to stdout' },
    { flag: '--out <path>', description: 'Save audio to file (uses hex decoding)' },
  ],
  examples: [
    'mmx music generate --prompt "Upbeat pop" --lyrics "La la la..." --out summer.mp3',
    'mmx music generate --prompt "Indie folk, melancholic" --lyrics-file song.txt --out my_song.mp3',
    '# Auto-generate lyrics from prompt:',
    'mmx music generate --prompt "Upbeat pop about summer" --lyrics-optimizer --out summer.mp3',
    '# Instrumental:',
    'mmx music generate --prompt "Cinematic orchestral, building tension" --instrumental --out bgm.mp3',
    '# URL output (24h expiry — download promptly):',
    'mmx music generate --prompt "Upbeat pop" --lyrics "La la la..." --output-format url',
    '# Instrumental with music-2.5+:',
    'mmx music generate --prompt "Cinematic orchestral" --model "music-2.5+" --instrumental --out bgm.mp3',
    '# Detailed prompt with vocal characteristics:',
    'mmx music generate --prompt "Warm morning folk" --vocals "male and female duet, harmonies in chorus" --instruments "acoustic guitar, piano" --bpm 95 --lyrics-file song.txt --out duet.mp3',
  ],
  async run(config: Config, flags: GlobalFlags) {
    let prompt = flags.prompt as string | undefined;
    let lyrics = flags.lyrics as string | undefined;
    const isInstrumental = flags.instrumental === true;
    const lyricsOptimizer = flags.lyricsOptimizer === true;

    if (flags.lyricsFile) {
      lyrics = readTextFromPathOrStdin(flags.lyricsFile as string);
    }

    if (isInstrumental && (lyrics || flags.lyricsFile)) {
      throw new CLIError(
        'Cannot use --instrumental with --lyrics or --lyrics-file.',
        ExitCode.USAGE,
        'mmx music generate --prompt <style> --instrumental',
      );
    }

    if (lyricsOptimizer && (lyrics || isInstrumental)) {
      throw new CLIError(
        'Cannot use --lyrics-optimizer with --lyrics, --lyrics-file, or --instrumental.',
        ExitCode.USAGE,
        'mmx music generate --prompt <text> --lyrics-optimizer',
      );
    }

    if (!prompt && !lyrics && !isInstrumental && !lyricsOptimizer) {
      throw new CLIError(
        'At least one of --prompt or --lyrics is required.',
        ExitCode.USAGE,
        'mmx music generate --prompt <text> --lyrics <text>',
      );
    }

    if (!isInstrumental && !lyricsOptimizer && !lyrics?.trim()) {
      throw new CLIError(
        'Lyrics are required. Add --lyrics or --lyrics-file, or use --instrumental for pure music, or --lyrics-optimizer to auto-generate.',
        ExitCode.USAGE,
        'mmx music generate --prompt <text> --lyrics <text>',
      );
    }

    // Build structured prompt from optional music characteristic flags.
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

    if (structuredParts.length > 0) {
      const structured = structuredParts.join('. ');
      prompt = prompt ? `${prompt}. ${structured}` : structured;
    }

    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const ext = (flags.format as string) || 'mp3';
    validateAudioFormat(ext);
    const outPath = (flags.out as string | undefined) ?? `music_${ts}.${ext}`;
    const format = detectOutputFormat(config.output);

    const model = (flags.model as string) || musicGenerateModel(config);
    const VALID_MODELS = ['music-2.6', 'music-2.6-free', 'music-2.5+', 'music-2.5'];
    if (flags.model && !VALID_MODELS.includes(model)) {
      throw new CLIError(
        `Invalid model "${model}". Valid models: ${VALID_MODELS.join(', ')}`,
        ExitCode.USAGE,
        'mmx music generate --model music-2.6',
      );
    }
    const outFormat = (flags.outputFormat as string) || 'hex';
    if (outFormat !== 'hex' && outFormat !== 'url') {
      throw new CLIError(
        '--output-format must be "hex" or "url".',
        ExitCode.USAGE,
        'mmx music generate --output-format url',
      );
    }
    if (flags.stream && outFormat === 'url') {
      throw new CLIError(
        '--stream and --output-format url cannot be used together. Streaming requires hex format.',
        ExitCode.USAGE,
        'mmx music generate --output-format url',
      );
    }
    const body: MusicRequest = {
      model,
      prompt,
      lyrics,
      is_instrumental: isInstrumental || undefined,
      lyrics_optimizer: lyricsOptimizer || undefined,
      audio_setting: {
        format: (flags.format as string) || 'mp3',
        sample_rate: (flags.sampleRate as number) ?? 44100,
        bitrate: (flags.bitrate as number) ?? 256000,
      },
      output_format: (flags.stream === true ? 'hex' : outFormat) as 'hex' | 'url',
      stream: flags.stream === true,
    };

    if (flags.aigcWatermark) body.aigc_watermark = true;

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

    if (!config.quiet) process.stderr.write(`[Model: ${model}]\n`);
    if (outFormat === 'url') {
      if (response.data?.audio_url) {
        console.log(response.data.audio_url);
      } else {
        throw new CLIError(
          'Requested URL output but API did not return audio_url.',
          ExitCode.GENERAL,
        );
      }
      return;
    }
    saveAudioOutput(response, outPath, format, config.quiet);
  },
});
