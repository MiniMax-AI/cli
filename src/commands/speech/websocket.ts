import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { writeFileSync } from 'fs';
import { speechWsEndpoint } from '../../client/endpoints';
import { resolveCredential } from '../../auth/resolver';
import { formatOutput, detectOutputFormat, dryRun } from '../../output/formatter';
import { readTextFromPathOrStdin } from '../../utils/fs';
import { T2A_FORMATS, formatList, validateAudioFormat, t2aDefaultSampleRate } from '../../utils/audio-formats';
import { ttsWebSocketAudioStream, type SpeechWebSocketRequest } from '../../utils/tts-websocket';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';

export default defineCommand({
  name: 'speech websocket',
  description: 'Synchronous TTS over WebSocket (streaming)',
  apiDocs: '/docs/api-reference/speech-t2a-websocket',
  usage: 'mmx speech websocket --text <text> [--out <path>] [flags]',
  options: [
    { flag: '--model <model>',           description: 'Model ID (default: speech-2.8-hd)' },
    { flag: '--text <text>',             description: 'Text to synthesize' },
    { flag: '--text-file <path>',        description: 'Read text from file (use - for stdin)' },
    { flag: '--voice <id>',              description: 'Voice ID (default: English_expressive_narrator)' },
    { flag: '--speed <n>',               description: 'Speech speed multiplier', type: 'number' },
    { flag: '--volume <n>',              description: 'Volume level', type: 'number' },
    { flag: '--pitch <n>',               description: 'Pitch adjustment', type: 'number' },
    { flag: '--format <fmt>',            description: `Audio format: ${formatList(T2A_FORMATS)} (default: mp3)` },
    { flag: '--sample-rate <hz>',        description: 'Sample rate (default: 32000)', type: 'number' },
    { flag: '--bitrate <bps>',           description: 'Bitrate (default: 128000)', type: 'number' },
    { flag: '--channels <n>',            description: 'Audio channels (default: 1)', type: 'number' },
    { flag: '--language <code>',         description: 'Language boost' },
    { flag: '--pronunciation <from/to>', description: 'Custom pronunciation (repeatable)', type: 'array' },
    { flag: '--out <path>',              description: 'Save audio to file' },
    { flag: '--stream',                  description: 'Stream raw audio to stdout as it arrives' },
  ],
  examples: [
    'mmx speech websocket --text "Hello, world!" --out hello.mp3',
    'mmx speech websocket --text "Stream" --stream | mpv --no-terminal -',
  ],
  async run(config: Config, flags: GlobalFlags) {
    let text = (flags.text ?? (flags._positional as string[] | undefined)?.[0]) as string | undefined;

    if (flags.textFile) {
      text = readTextFromPathOrStdin(flags.textFile as string);
    }

    if (!text) {
      throw new CLIError(
        '--text or --text-file is required.',
        ExitCode.USAGE,
        'mmx speech websocket --text "Hello" --out hello.mp3',
      );
    }

    const model = (flags.model as string)
      || config.defaultSpeechModel
      || 'speech-2.8-hd';
    const voice = (flags.voice as string) || 'English_expressive_narrator';
    const ext = (flags.format as string) || 'mp3';
    validateAudioFormat(ext, T2A_FORMATS);

    const request: SpeechWebSocketRequest = {
      model,
      text,
      voice_setting: {
        voice_id: voice,
        speed: (flags.speed as number) ?? undefined,
        vol: (flags.volume as number) ?? undefined,
        pitch: (flags.pitch as number) ?? undefined,
      },
      audio_setting: {
        format: ext,
        sample_rate: (flags.sampleRate as number) ?? t2aDefaultSampleRate(ext, 32000),
        bitrate: (flags.bitrate as number) ?? 128000,
        channel: (flags.channels as number) ?? 1,
      },
    };

    if (flags.language) request.language_boost = flags.language as string;

    if (flags.pronunciation) {
      request.pronunciation_dict = {
        tone: flags.pronunciation as string[],
      };
    }

    if (dryRun(config, request)) return;

    const format = detectOutputFormat(config.output);
    const credential = await resolveCredential(config);
    const url = speechWsEndpoint(config.baseUrl);

    if (!config.quiet) process.stderr.write(`[Model: ${model}]\n`);

    if (flags.stream) {
      process.stdout.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EPIPE') process.exit(0);
        throw err;
      });

      for await (const chunk of ttsWebSocketAudioStream(url, credential.token, request)) {
        if (!process.stdout.write(chunk)) {
          await new Promise<void>(r => process.stdout.once('drain', r));
        }
      }
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of ttsWebSocketAudioStream(url, credential.token, request)) {
      chunks.push(Buffer.from(chunk));
    }

    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const outPath = (flags.out as string | undefined) ?? `speech_${ts}.${ext}`;
    writeFileSync(outPath, Buffer.concat(chunks));

    if (config.quiet) {
      console.log(outPath);
    } else {
      console.log(formatOutput({ saved: outPath }, format));
    }
  },
});
