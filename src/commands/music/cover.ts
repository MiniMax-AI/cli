import { readFileSync } from 'fs';
import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { request, requestJson } from '../../client/http';
import { musicEndpoint } from '../../client/endpoints';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import { saveAudioOutput } from '../../output/audio';
import { AUDIO_FORMATS_DISPLAY, validateAudioFormat } from '../../utils/audio-formats';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { MusicRequest, MusicResponse } from '../../types/api';
import { musicCoverModel } from './models';

export default defineCommand({
  name: 'music cover',
  description: 'Generate a cover version of a song based on reference audio (music-cover / music-cover-free)',
  apiDocs: '/docs/api-reference/music-generation',
  usage: 'mmx music cover --prompt <text> (--audio <url> | --audio-file <path>) [--lyrics <text>] [--out <path>] [flags]',
  options: [
    { flag: '--model <model>', description: 'Model: music-cover (Token Plan), music-cover-free (Pay-as-you-go, default). Override only if needed.' },
    { flag: '--prompt <text>', description: 'Target cover style, e.g. "Indie folk, acoustic guitar, warm male vocal"' },
    { flag: '--audio <url>', description: 'URL of the reference audio (mp3, wav, flac, etc. — 6s to 6min, max 50MB)' },
    { flag: '--audio-file <path>', description: 'Local reference audio file (auto base64-encoded)' },
    { flag: '--lyrics <text>', description: 'Cover lyrics. If omitted, extracted from reference audio via ASR.' },
    { flag: '--lyrics-file <path>', description: 'Read lyrics from file (use - for stdin)' },
    { flag: '--seed <number>', description: 'Random seed 0–1000000 for reproducible results', type: 'number' },
    { flag: '--format <fmt>', description: `Audio format: ${AUDIO_FORMATS_DISPLAY} (default: mp3)` },
    { flag: '--sample-rate <hz>', description: 'Sample rate: 16000, 24000, 32000, 44100 (default: 44100)', type: 'number' },
    { flag: '--bitrate <bps>', description: 'Bitrate: 32000, 64000, 128000, 256000 (default: 256000)', type: 'number' },
    { flag: '--channel <n>', description: 'Channels: 1 (mono) or 2 (stereo, default)', type: 'number' },
    { flag: '--stream', description: 'Stream raw audio to stdout' },
    { flag: '--out <path>', description: 'Save audio to file' },
  ],
  examples: [
    'mmx music cover --prompt "Indie folk, acoustic guitar, warm male vocal" --audio https://example.com/song.mp3 --out cover.mp3',
    'mmx music cover --prompt "Jazz, piano, slow" --audio-file original.mp3 --lyrics-file lyrics.txt --out jazz_cover.mp3',
    'mmx music cover --prompt "Pop, upbeat" --audio https://example.com/ref.mp3 --seed 42 --out reproducible.mp3',
  ],
  async run(config: Config, flags: GlobalFlags) {
    const prompt = flags.prompt as string | undefined;
    const audioUrl = flags.audio as string | undefined;
    const audioFile = flags.audioFile as string | undefined;

    if (!prompt) {
      throw new CLIError('--prompt is required.', ExitCode.USAGE, 'mmx music cover --prompt <text> --audio <url>');
    }

    if (!audioUrl && !audioFile) {
      throw new CLIError(
        'One of --audio <url> or --audio-file <path> is required.',
        ExitCode.USAGE,
        'mmx music cover --prompt <text> --audio <url>',
      );
    }

    if (audioUrl && audioFile) {
      throw new CLIError('Use either --audio or --audio-file, not both.', ExitCode.USAGE);
    }

    let lyrics = flags.lyrics as string | undefined;
    if (flags.lyricsFile) {
      const { readTextFromPathOrStdin } = await import('../../utils/fs');
      lyrics = readTextFromPathOrStdin(flags.lyricsFile as string);
    }

    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const ext = (flags.format as string) || 'mp3';
    validateAudioFormat(ext);
    const outPath = (flags.out as string | undefined) ?? `cover_${ts}.${ext}`;
    const format = detectOutputFormat(config.output);

    const model = (flags.model as string) || musicCoverModel(config);
    const VALID_MODELS = ['music-cover', 'music-cover-free'];
    if (flags.model && !VALID_MODELS.includes(model)) {
      throw new CLIError(
        `Invalid model "${model}". Valid models: ${VALID_MODELS.join(', ')}`,
        ExitCode.USAGE,
        'mmx music cover --model music-cover',
      );
    }
    const body: MusicRequest = {
      model,
      prompt,
      lyrics,
      seed: flags.seed as number | undefined,
      audio_setting: {
        format: ext,
        sample_rate: (flags.sampleRate as number) ?? 44100,
        bitrate: (flags.bitrate as number) ?? 256000,
        channel: (flags.channel as number) ?? undefined,
      },
      output_format: 'hex',
      stream: flags.stream === true,
    };

    if (audioUrl) {
      body.audio_url = audioUrl;
    } else {
      body.audio_base64 = readFileSync(audioFile!).toString('base64');
    }

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
    saveAudioOutput(response, outPath, format, config.quiet);
  },
});
