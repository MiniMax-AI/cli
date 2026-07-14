import { readFileSync } from 'fs';
import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { request, requestJson } from '../../client/http';
import { musicCoverPreprocessEndpoint, musicEndpoint } from '../../client/endpoints';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import { saveAudioOutput } from '../../output/audio';
import { MUSIC_FORMATS, formatList, validateAudioFormat } from '../../utils/audio-formats';
import { pipeAudioStream } from '../../utils/audio-stream';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { CoverPreprocessRequest, CoverPreprocessResponse, MusicRequest, MusicResponse } from '../../types/api';
import { musicCoverModel } from './models';

export default defineCommand({
  name: 'music cover',
  description: 'Generate a cover version of a song based on reference audio (music-cover)',
  apiDocs: '/docs/api-reference/music-generation',
  usage: 'mmx music cover --prompt <text> (--audio <url> | --audio-file <path>) [--lyrics <text>] [--out <path>] [flags]',
  options: [
    { flag: '--model <model>', description: 'Model: music-cover (default).' },
    { flag: '--prompt <text>', description: 'Target cover style, e.g. "Indie folk, acoustic guitar, warm male vocal"' },
    { flag: '--audio <url>', description: 'URL of the reference audio (mp3, wav, flac, etc. — 6s to 6min, max 50MB)' },
    { flag: '--audio-file <path>', description: 'Local reference audio file (auto base64-encoded)' },
    { flag: '--lyrics <text>', description: 'Cover lyrics. If provided, CLI auto-runs cover preprocess first. If omitted, lyrics are extracted from reference audio via ASR.' },
    { flag: '--lyrics-file <path>', description: 'Read lyrics from file (use - for stdin). Triggers cover preprocess automatically.' },
    { flag: '--seed <number>', description: 'Random seed 0–1000000 for reproducible results', type: 'number' },
    { flag: '--format <fmt>', description: `Audio format: ${formatList(MUSIC_FORMATS)} (default: mp3)` },
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
    validateAudioFormat(ext, MUSIC_FORMATS);
    const outPath = (flags.out as string | undefined) ?? `cover_${ts}.${ext}`;
    const format = detectOutputFormat(config.output);

    const model = (flags.model as string) || musicCoverModel(config);
    const VALID_MODELS = ['music-cover'];
    if (flags.model && !VALID_MODELS.includes(model)) {
      throw new CLIError(
        `Invalid model "${model}". Valid models: ${VALID_MODELS.join(', ')}`,
        ExitCode.USAGE,
        'mmx music cover --model music-cover',
      );
    }
    const audioSource: Pick<MusicRequest, 'audio_url' | 'audio_base64'> = audioUrl
      ? { audio_url: audioUrl }
      : { audio_base64: readFileSync(audioFile!).toString('base64') };

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
      ...audioSource,
    };

    const needsPreprocess = Boolean(lyrics?.trim());
    const preprocessBody: CoverPreprocessRequest | undefined = needsPreprocess
      ? {
          model: 'music-cover',
          ...audioSource,
        }
      : undefined;

    if (needsPreprocess) {
      delete body.audio_url;
      delete body.audio_base64;
      body.cover_feature_id = '__cover_feature_id_from_preprocess__';
    }

    if (config.dryRun) {
      console.log(formatOutput(needsPreprocess ? { preprocess_request: preprocessBody, request: body } : { request: body }, format));
      return;
    }

    const url = musicEndpoint(config.baseUrl);

    if (needsPreprocess) {
      const preprocessUrl = musicCoverPreprocessEndpoint(config.baseUrl);
      const preprocessResponse = await requestJson<CoverPreprocessResponse>(config, {
        url: preprocessUrl,
        method: 'POST',
        body: preprocessBody,
      });

      body.cover_feature_id = preprocessResponse.cover_feature_id;
    }

    if (flags.stream) {
      const res = await request(config, { url, method: 'POST', body, stream: true });
      await pipeAudioStream(res);
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
