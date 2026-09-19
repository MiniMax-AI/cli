import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { request, requestJson } from '../../client/http';
import { parseSSE } from '../../client/stream';
import { speechToTextEndpoint } from '../../client/endpoints';
import { resolveFileUploadPath } from '../../files/upload';
import { detectOutputFormat, dryRun, formatOutput } from '../../output/formatter';
import { formatList, validateAudioFormat } from '../../utils/audio-formats';
import {
  STT_DEFAULT_MODEL,
  STT_RESPONSE_FORMATS,
  sttStreamFormatConflict,
  validateSttFileSize,
} from '../../utils/stt';
import { promptOrFail } from '../../utils/prompt';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { SpeechToTextResponse, SpeechToTextStreamEvent } from '../../types/api';

/** srt/vtt come back as subtitle documents, not as JSON. */
function isSubtitleFormat(responseFormat: string): boolean {
  return responseFormat === 'srt' || responseFormat === 'vtt';
}

/** Results are emitted verbatim, only guaranteeing a final newline. */
function withTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

export default defineCommand({
  name: 'speech transcribe',
  description: 'Transcribe an audio file to text (asr-1.0)',
  apiDocs: '/docs/api-reference/speech-to-text',
  usage: 'mmx speech transcribe --file <path> [flags]',
  options: [
    { flag: '--file <path>',             description: 'Audio file to transcribe (mp3, wav, m4a, flac, aac, opus, ogg, aiff)', required: true },
    { flag: '--model <model>',           description: `Model ID (default: ${STT_DEFAULT_MODEL})` },
    { flag: '--response-format <fmt>',   description: `Transcription format: ${formatList(STT_RESPONSE_FORMATS)} (default: json)` },
    { flag: '--language <code>',         description: 'BCP-47 language hint (zh, en, ja, ...); omit for automatic detection' },
    { flag: '--timestamp-level <level>', description: 'Timestamp granularity: sentence, word (verbose_json / srt / vtt only)' },
    { flag: '--stream',                  description: 'Stream incremental text to stdout (json only)' },
    { flag: '--out <path>',              description: 'Write the result to a file instead of stdout' },
  ],
  examples: [
    'mmx speech transcribe --file meeting.mp3',
    'mmx speech transcribe --file call.mp3 --language zh',
    'mmx speech transcribe --file talk.mp3 --response-format verbose_json --output json',
    'mmx speech transcribe --file talk.mp3 --response-format srt --out talk.srt',
    'mmx speech transcribe --file long.mp3 --stream',
  ],
  async run(config: Config, flags: GlobalFlags) {
    const fileInput = (flags.file ?? (flags._positional as string[] | undefined)?.[0]) as string | undefined;
    const filePath = await promptOrFail({
      value: fileInput,
      message: 'Enter audio file path:',
      cancelMessage: 'Transcription cancelled.',
      flagName: 'file',
      usageHint: 'mmx speech transcribe --file <path>',
      nonInteractive: config.nonInteractive,
    });

    const fullPath = resolveFileUploadPath(
      filePath,
      (path) => new CLIError(`File not found: ${path}`, ExitCode.USAGE),
    );

    const model = (flags.model as string) || STT_DEFAULT_MODEL;
    const responseFormat = (flags.responseFormat as string) || 'json';
    const language = (flags.language as string) || undefined;
    const timestampLevel = (flags.timestampLevel as string) || undefined;
    const stream = flags.stream === true;
    const outPath = flags.out ? resolve(flags.out as string) : undefined;

    validateAudioFormat(responseFormat, STT_RESPONSE_FORMATS);
    validateSttFileSize(fullPath, statSync(fullPath).size);

    const streamConflict = sttStreamFormatConflict(responseFormat, stream);
    if (streamConflict) throw new CLIError(streamConflict, ExitCode.USAGE);
    if (stream && outPath) {
      throw new CLIError(
        '--stream and --out cannot be combined.',
        ExitCode.USAGE,
        'Redirect stdout instead: mmx speech transcribe --file <path> --stream > transcript.txt',
      );
    }

    const preview: Record<string, unknown> = { model, response_format: responseFormat, file: fullPath };
    if (language) preview.language = language;
    if (timestampLevel) preview.timestamp_level = timestampLevel;
    if (stream) preview.stream = true;
    if (dryRun(config, preview)) return;

    const form = new FormData();
    form.append('model', model);
    form.append('file', new Blob([readFileSync(fullPath)]), basename(fullPath));
    form.append('response_format', responseFormat);
    if (timestampLevel) form.append('timestamp_level', timestampLevel);
    if (stream) form.append('stream', 'true');

    // `language` only takes effect as a request header: the API accepts (and
    // ignores) the same value as a form field.
    const headers: Record<string, string> = {};
    if (language) headers.language = language;

    const url = speechToTextEndpoint(config.baseUrl);
    const format = detectOutputFormat(config.output);

    if (stream) {
      const res = await request(config, { url, method: 'POST', body: form, headers, stream: true });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('text/event-stream')) {
        throw new CLIError(
          `Expected SSE stream but got content-type "${contentType}". Server may be experiencing issues.`,
          ExitCode.GENERAL,
        );
      }

      let text = '';
      let duration: number | undefined;
      const toStdout = format !== 'json';
      for await (const event of parseSSE(res)) {
        if (event.data === '[DONE]') break;
        let chunk: SpeechToTextStreamEvent;
        try {
          chunk = JSON.parse(event.data) as SpeechToTextStreamEvent;
        } catch (err) {
          // Warn but keep going — partial text beats failing the whole run.
          process.stderr.write(`[warning] Failed to parse stream chunk: ${err instanceof Error ? err.message : String(err)}\n`);
          continue;
        }
        if (chunk.delta) {
          text += chunk.delta;
          if (toStdout) process.stdout.write(chunk.delta);
        }
        if (chunk.finish) duration = chunk.duration;
      }

      if (toStdout) {
        process.stdout.write('\n');
      } else {
        process.stdout.write(withTrailingNewline(formatOutput({ text, duration }, format)));
      }
      return;
    }

    if (!config.quiet) process.stderr.write(`[Model: ${model}]\n`);

    let payload: string;
    let duration: number | undefined;

    if (isSubtitleFormat(responseFormat)) {
      const res = await request(config, { url, method: 'POST', body: form, headers });
      payload = await res.text();
    } else {
      const response = await requestJson<SpeechToTextResponse>(config, {
        url,
        method: 'POST',
        body: form,
        headers,
      });
      duration = response.duration;
      payload = format === 'json' ? formatOutput(response, format) : response.text;
    }

    if (outPath) {
      writeFileSync(outPath, withTrailingNewline(payload), 'utf-8');
      if (config.quiet) {
        console.log(outPath);
      } else {
        const saved: Record<string, unknown> = { saved: outPath };
        if (duration !== undefined) saved.duration = duration;
        console.log(formatOutput(saved, format));
      }
      return;
    }

    process.stdout.write(withTrailingNewline(payload));
  },
});
