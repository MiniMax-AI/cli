import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { parseSSE } from '../../client/stream';
import { speechToTextEndpoint } from '../../client/endpoints';
import { resolveFileUploadPath } from '../../files/upload';
import { detectOutputFormat, dryRun, formatOutput } from '../../output/formatter';
import {
  STT_DEFAULT_MODEL,
  STT_RESPONSE_FORMATS,
  isSubtitleFormat,
  sttFormFields,
  submitSttForm,
  validateSttFileSize,
  validateSttResponseFormat,
  validateSttStreaming,
} from '../../utils/stt';
import { promptOrFail } from '../../utils/prompt';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type {
  SpeechToTextFormat,
  SpeechToTextStreamEvent,
  SpeechToTextTimestampLevel,
} from '../../types/api';

/**
 * Stdout only gets a guaranteed final newline (terminal convention); subtitle
 * documents written with `--out` are byte-exact, per the API's own bytes.
 */
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
    { flag: '--response-format <fmt>',   description: `Transcription format: ${STT_RESPONSE_FORMATS.join(', ')} (default: json)` },
    { flag: '--language <code>',         description: 'BCP-47 language hint (zh, en, ja, ...); omit for automatic detection' },
    { flag: '--timestamp-level <level>', description: 'Timestamp granularity: sentence, word (verbose_json / srt / vtt only)' },
    { flag: '--stream',                  description: 'Stream incremental text (json only; pair with --output text when piping)' },
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

    validateSttResponseFormat(responseFormat);
    validateSttFileSize(fullPath, statSync(fullPath).size);
    validateSttStreaming(responseFormat, stream);
    // --timestamp-level and --model are passed through, not validated here: the
    // CLI never interprets them, and the API documents them as ignored (for
    // timestamp_level with json) or server-validated, so a local allow-list
    // would only go stale.

    if (stream && outPath) {
      throw new CLIError(
        '--stream and --out cannot be combined.',
        ExitCode.USAGE,
        'Redirect stdout instead: mmx speech transcribe --file <path> --stream --output text > transcript.txt',
      );
    }

    // One source for the multipart text parts, so the dry-run preview and the
    // request cannot drift apart.
    const fields = sttFormFields({
      model,
      response_format: responseFormat as SpeechToTextFormat,
      timestamp_level: timestampLevel as SpeechToTextTimestampLevel | undefined,
      stream,
    });

    const preview: Record<string, unknown> = { ...fields, file: fullPath };
    if (language) preview.language = language;
    if (dryRun(config, preview)) return;

    const form = new FormData();
    for (const [field, value] of Object.entries(fields)) form.append(field, value);
    form.append('file', new Blob([readFileSync(fullPath)]), basename(fullPath));

    // `language` only takes effect as a request header: the API accepts (and
    // ignores) the same value as a form field.
    const headers: Record<string, string> = {};
    if (language) headers.language = language;

    const url = speechToTextEndpoint(config.baseUrl);
    const format = detectOutputFormat(config.output);

    if (!config.quiet) process.stderr.write(`[Model: ${model}]\n`);

    // One submission for every format; the reply shape decides how it is read.
    const submission = await submitSttForm({ config, url, form, headers, responseFormat, stream });

    if (submission.kind === 'stream') {
      const res = submission.res;

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('text/event-stream')) {
        throw new CLIError(
          `Expected SSE stream but got content-type "${contentType}". Server may be experiencing issues.`,
          ExitCode.GENERAL,
        );
      }

      // The API numbers events from 0; deltas are concatenated by `index`, so a
      // gap or repeat is surfaced instead of silently jumbling the transcript.
      const parts: Array<{ index: number; delta: string }> = [];
      let nextIndex = 0;
      let duration: number | undefined;
      let finished = false;
      const toStdout = format !== 'json';
      try {
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
          if (typeof chunk.index === 'number' && chunk.index !== nextIndex) {
            process.stderr.write(`[warning] Stream events arrived out of order (expected index ${nextIndex}, got ${chunk.index}).\n`);
          }
          if (typeof chunk.index === 'number') nextIndex = chunk.index + 1;
          if (chunk.delta) {
            parts.push({ index: typeof chunk.index === 'number' ? chunk.index : parts.length, delta: chunk.delta });
            if (toStdout) process.stdout.write(chunk.delta);
          }
          if (chunk.finish) {
            duration = chunk.duration;
            finished = true;
            break;
          }
        }
      } finally {
        // Stopping at the final event leaves the SSE body undrained, which keeps
        // the connection (and the process) alive; release it either way.
        await res.body?.cancel().catch(() => undefined);
      }

      if (!finished) {
        process.stderr.write('[warning] Stream ended before the final event; the transcript may be incomplete.\n');
      }

      // Assembled by index, per the API's contract — arrival order only shows
      // through on stdout, where deltas are printed as they come.
      const text = parts.sort((a, b) => a.index - b.index).map((part) => part.delta).join('');

      if (toStdout) {
        process.stdout.write('\n');
      } else {
        process.stdout.write(withTrailingNewline(formatOutput({ text, duration }, format)));
      }

      // Only the final event carries the audio duration, so it is reported once
      // the stream is drained — after stdout is closed out.
      if (!config.quiet && duration !== undefined) {
        process.stderr.write(`[Duration: ${duration}s]\n`);
      }
      return;
    }

    let payload: string;
    let duration: number | undefined;

    if (submission.kind === 'subtitle') {
      payload = submission.document;
    } else {
      duration = submission.response.duration;
      payload = format === 'json' ? formatOutput(submission.response, format) : submission.response.text;
    }

    if (outPath) {
      try {
        // Subtitle documents are saved byte-exact; text transcripts keep the
        // trailing-newline convention for plain-text files.
        writeFileSync(
          outPath,
          isSubtitleFormat(responseFormat) ? payload : withTrailingNewline(payload),
          'utf-8',
        );
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOSPC') {
          throw new CLIError(
            'Disk full — cannot write transcript file.',
            ExitCode.GENERAL,
            'Free up disk space and try again.',
          );
        }
        throw err;
      }
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
