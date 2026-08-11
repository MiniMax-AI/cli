import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { requestJson } from '../../client/http';
import {
  fileUploadEndpoint,
  speechAsyncEndpoint,
  speechAsyncFileEndpoint,
  speechAsyncQueryEndpoint,
} from '../../client/endpoints';
import { resolveCredential } from '../../auth/resolver';
import { poll } from '../../polling/poll';
import { downloadFile } from '../../files/download';
import { formatOutput, detectOutputFormat, dryRun } from '../../output/formatter';
import { readTextFromPathOrStdin } from '../../utils/fs';
import { T2A_FORMATS, formatList, validateAudioFormat, t2aDefaultSampleRate } from '../../utils/audio-formats';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type {
  FileUploadResponse,
  SpeechAsyncRequest,
  SpeechAsyncQueryResponse,
  SpeechAsyncResponse,
} from '../../types/api';

const DIRECT_TEXT_LIMIT = 50_000;

async function uploadTextFile(config: Config, path: string): Promise<string> {
  const text = readTextFromPathOrStdin(path);
  const fileName = path === '-' ? 'stdin.txt' : path.split(/[\\/]/).pop() || 'input.txt';
  const formData = new FormData();
  formData.append('file', new Blob([text], { type: 'text/plain' }), fileName);
  formData.append('purpose', 't2a_async_input');

  const response = await requestJson<FileUploadResponse>(config, {
    url: fileUploadEndpoint(config.baseUrl),
    method: 'POST',
    body: formData,
  });
  return response.file.file_id;
}

export default defineCommand({
  name: 'speech async',
  description: 'Create an asynchronous TTS task (long-form, up to 1M chars)',
  apiDocs: '/docs/api-reference/speech-t2a-async-create',
  usage: 'mmx speech async --text <text> [--wait] [--out <path>] [flags]',
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
    { flag: '--wait',                    description: 'Poll until the task completes, then download the audio' },
    { flag: '--poll-interval <seconds>', description: 'Polling interval when waiting (default: 5)', type: 'number' },
    { flag: '--out <path>',              description: 'Save audio to file (used with --wait)' },
  ],
  examples: [
    'mmx speech async --text "Long text to synthesize..."',
    'mmx speech async --text "Long text..." --wait --out long.mp3',
    'mmx speech async --text "Hello" --output json',
  ],
  async run(config: Config, flags: GlobalFlags) {
    const text = (flags.text ?? (flags._positional as string[] | undefined)?.[0]) as string | undefined;
    const textFile = flags.textFile as string | undefined;

    if (!text && !textFile) {
      throw new CLIError(
        '--text or --text-file is required.',
        ExitCode.USAGE,
        'mmx speech async --text "Long text" --wait --out long.mp3',
      );
    }

    if (text && text.length > DIRECT_TEXT_LIMIT) {
      throw new CLIError(
        `--text is limited to ${DIRECT_TEXT_LIMIT.toLocaleString('en-US')} characters. Use --text-file for longer input.`,
        ExitCode.USAGE,
        'mmx speech async --text-file long.txt --wait --out long.mp3',
      );
    }

    const model = (flags.model as string)
      || config.defaultSpeechModel
      || 'speech-2.8-hd';
    const voice = (flags.voice as string) || 'English_expressive_narrator';
    const ext = (flags.format as string) || 'mp3';
    validateAudioFormat(ext, T2A_FORMATS);

    const body: SpeechAsyncRequest = {
      model,
      voice_setting: {
        voice_id: voice,
        speed: (flags.speed as number) ?? undefined,
        vol: (flags.volume as number) ?? undefined,
        pitch: (flags.pitch as number) ?? undefined,
      },
      audio_setting: {
        format: ext,
        audio_sample_rate: (flags.sampleRate as number) ?? t2aDefaultSampleRate(ext, 32000),
        bitrate: (flags.bitrate as number) ?? 128000,
        channel: (flags.channels as number) ?? 1,
      },
    };

    if (flags.language) body.language_boost = flags.language as string;

    if (flags.pronunciation) {
      body.pronunciation_dict = {
        tone: flags.pronunciation as string[],
      };
    }

    if (textFile) {
      if (config.dryRun) {
        body.text_file_id = '<uploaded file id>';
      } else {
        body.text_file_id = await uploadTextFile(config, textFile);
      }
    } else {
      body.text = text;
    }

    if (dryRun(config, body)) return;

    const format = detectOutputFormat(config.output);
    const url = speechAsyncEndpoint(config.baseUrl);

    const response = await requestJson<SpeechAsyncResponse>(config, {
      url,
      method: 'POST',
      body,
    });

    const taskId = response.task_id;

    if (!flags.wait) {
      console.log(formatOutput({
        task_id: taskId,
        file_id: response.file_id,
        usage_characters: response.usage_characters,
      }, format));
      return;
    }

    if (!config.quiet) process.stderr.write(`[Model: ${model}]\n`);

    const result = await poll<SpeechAsyncQueryResponse>(config, {
      url: speechAsyncQueryEndpoint(config.baseUrl, taskId),
      intervalSec: (flags.pollInterval as number) ?? 5,
      timeoutSec: config.timeout,
      isComplete: (d) => (d as SpeechAsyncQueryResponse).status === 'Success',
      isFailed: (d) => ['Failed', 'Expired'].includes((d as SpeechAsyncQueryResponse).status),
      getStatus: (d) => (d as SpeechAsyncQueryResponse).status,
    });

    const fileId = result.file_id;
    if (!fileId) {
      throw new CLIError(
        'Task completed but no file_id returned.',
        ExitCode.GENERAL,
      );
    }

    const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const outPath = (flags.out as string | undefined) ?? `speech_${ts}.${ext}`;

    const credential = await resolveCredential(config);
    await downloadFile(speechAsyncFileEndpoint(config.baseUrl, fileId), outPath, {
      quiet: config.quiet,
      headers: { Authorization: `Bearer ${credential.token}` },
    });

    if (config.quiet) {
      console.log(outPath);
    } else {
      console.log(formatOutput({
        task_id: taskId,
        status: result.status,
        file_id: fileId,
        saved: outPath,
      }, format));
    }
  },
});
