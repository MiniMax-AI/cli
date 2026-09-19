import { describe, it, expect } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { default as transcribeCommand } from '../../../src/commands/speech/transcribe';
import { STT_MAX_FILE_BYTES } from '../../../src/utils/stt';
import { jsonResponse, sseResponse } from '../../helpers/mock-server';
import { withStubbedFetch } from '../../helpers/fetch-stub';

const baseConfig = {
  apiKey: 'test-key',
  region: 'global' as const,
  baseUrl: 'https://api.mmx.io',
  output: 'text' as const,
  timeout: 10,
  verbose: false,
  quiet: false,
  noColor: true,
  yes: false,
  dryRun: false,
  nonInteractive: true,
  async: false,
};

const baseFlags = {
  quiet: false,
  verbose: false,
  noColor: true,
  yes: false,
  dryRun: false,
  help: false,
  nonInteractive: true,
  async: false,
};

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const originalWrite = process.stdout.write;
  let output = '';
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    return true;
  }) as typeof process.stdout.write;

  try {
    await fn();
    return output;
  } finally {
    process.stdout.write = originalWrite;
  }
}

async function captureLog(fn: () => Promise<void>): Promise<string> {
  const originalLog = console.log;
  let output = '';
  console.log = (msg: unknown) => { output += String(msg); };

  try {
    await fn();
    return output;
  } finally {
    console.log = originalLog;
  }
}

async function captureStderr(fn: () => Promise<void>): Promise<string> {
  const originalWrite = process.stderr.write;
  let output = '';
  process.stderr.write = ((chunk: string | Uint8Array) => {
    output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    return true;
  }) as typeof process.stderr.write;

  try {
    await fn();
    return output;
  } finally {
    process.stderr.write = originalWrite;
  }
}

function makeTempAudio(contents = 'fake audio bytes'): { dir: string; filePath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'mmx-transcribe-test-'));
  const filePath = join(dir, 'fixture.mp3');
  writeFileSync(filePath, contents);
  return { dir, filePath };
}

describe('speech transcribe command', () => {
  it('has correct name', () => {
    expect(transcribeCommand.name).toBe('speech transcribe');
  });

  it('requires --file in non-interactive mode', async () => {
    await expect(
      transcribeCommand.execute(baseConfig, baseFlags),
    ).rejects.toThrow('Missing required argument: --file');
  });

  it('throws when the audio file does not exist', async () => {
    try {
      await transcribeCommand.execute(baseConfig, {
        ...baseFlags,
        file: '/tmp/nonexistent-audio-xxxxx.mp3',
      });
      throw new Error('Expected transcribe to reject');
    } catch (error) {
      expect(error).toMatchObject({
        name: 'CLIError',
        message: expect.stringContaining('File not found'),
        exitCode: 2,
      });
    }
  });

  it('rejects an invalid --response-format before uploading anything', async () => {
    const { dir, filePath } = makeTempAudio();

    try {
      await expect(
        transcribeCommand.execute(baseConfig, { ...baseFlags, file: filePath, responseFormat: 'txt' }),
      ).rejects.toThrow(/Invalid response format "txt"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects an audio file above the 50 MB limit before uploading', async () => {
    const { dir, filePath } = makeTempAudio();

    try {
      truncateSync(filePath, STT_MAX_FILE_BYTES + 1);
      await expect(
        transcribeCommand.execute(baseConfig, { ...baseFlags, file: filePath }),
      ).rejects.toThrow(/speech-to-text allows at most 50 MB/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects --stream combined with a non-json response format', async () => {
    const { dir, filePath } = makeTempAudio();

    try {
      await expect(
        transcribeCommand.execute(baseConfig, {
          ...baseFlags,
          file: filePath,
          stream: true,
          responseFormat: 'srt',
        }),
      ).rejects.toThrow(/cannot be combined with stream=true/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects --stream combined with --out', async () => {
    const { dir, filePath } = makeTempAudio();

    try {
      await expect(
        transcribeCommand.execute(baseConfig, {
          ...baseFlags,
          file: filePath,
          stream: true,
          out: join(dir, 'out.txt'),
        }),
      ).rejects.toThrow(/--stream and --out cannot be combined/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('shows the multipart fields in dry-run without network access', async () => {
    const { dir, filePath } = makeTempAudio();

    try {
      const captured = await captureLog(async () => {
        await transcribeCommand.execute(
          { ...baseConfig, output: 'json' as const, dryRun: true },
          { ...baseFlags, dryRun: true, file: filePath, language: 'zh' },
        );
      });

      const request = JSON.parse(captured).request;
      expect(request.model).toBe('asr-1.0');
      expect(request.response_format).toBe('json');
      expect(request.language).toBe('zh');
      expect(request.file).toBe(filePath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uploads the audio as multipart and prints the transcript', async () => {
    const { dir, filePath } = makeTempAudio('fixture audio');

    try {
      await withStubbedFetch(
        () => jsonResponse({ text: 'hello world', duration: 1.5, trace_id: 'trace-1' }),
        async (sent) => {
          const captured = await captureStdout(async () => {
            await transcribeCommand.execute(baseConfig, { ...baseFlags, file: filePath });
          });

          expect(sent.url).toBe('https://api.mmx.io/v1/speech_to_text');
          expect(sent.init?.method).toBe('POST');
          expect(sent.init?.body).toBeInstanceOf(FormData);

          const body = sent.init?.body as FormData;
          expect(body.get('model')).toBe('asr-1.0');
          expect(body.get('response_format')).toBe('json');
          expect(body.get('stream')).toBeNull();

          const uploaded = body.get('file');
          expect(uploaded).toBeInstanceOf(Blob);
          expect((uploaded as File).name).toBe('fixture.mp3');
          expect(await (uploaded as Blob).text()).toBe('fixture audio');

          expect(captured).toBe('hello world\n');
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sends --language as a request header, never as a form field', async () => {
    const { dir, filePath } = makeTempAudio();

    try {
      await withStubbedFetch(
        () => jsonResponse({ text: '你好', duration: 1 }),
        async (sent) => {
          await captureStdout(async () => {
            await transcribeCommand.execute(baseConfig, {
              ...baseFlags,
              file: filePath,
              language: 'zh',
            });
          });

          expect(sent.init?.headers).toMatchObject({
            Authorization: 'Bearer test-key',
            language: 'zh',
          });
          expect((sent.init?.body as FormData).get('language')).toBeNull();
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes --model and --timestamp-level through as form fields', async () => {
    const { dir, filePath } = makeTempAudio();

    try {
      await withStubbedFetch(
        () => jsonResponse({ text: 'hi', duration: 1, n_speakers: 1, segments: [] }),
        async (sent) => {
          await captureStdout(async () => {
            await transcribeCommand.execute(baseConfig, {
              ...baseFlags,
              file: filePath,
              model: 'asr-1.0',
              responseFormat: 'verbose_json',
              timestampLevel: 'word',
            });
          });

          const body = sent.init?.body as FormData;
          expect(body.get('response_format')).toBe('verbose_json');
          expect(body.get('timestamp_level')).toBe('word');
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints the full response under --output json', async () => {
    const { dir, filePath } = makeTempAudio();

    try {
      await withStubbedFetch(
        () => jsonResponse({
          text: 'hi',
          duration: 2,
          n_speakers: 2,
          segments: [{ id: 0, start: 0, end: 2, speaker: 'S1', text: 'hi' }],
        }),
        async () => {
          const captured = await captureStdout(async () => {
            await transcribeCommand.execute(
              { ...baseConfig, output: 'json' as const },
              { ...baseFlags, file: filePath, responseFormat: 'verbose_json' },
            );
          });

          const parsed = JSON.parse(captured);
          expect(parsed.n_speakers).toBe(2);
          expect(parsed.segments[0].speaker).toBe('S1');
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints srt subtitles verbatim', async () => {
    const { dir, filePath } = makeTempAudio();
    const srt = '1\n00:00:00,080 --> 00:00:04,540\nhello\n\n';

    try {
      await withStubbedFetch(
        () => new Response(srt, { status: 200, headers: { 'Content-Type': 'text/plain' } }),
        async (sent) => {
          const captured = await captureStdout(async () => {
            await transcribeCommand.execute(baseConfig, {
              ...baseFlags,
              file: filePath,
              responseFormat: 'srt',
            });
          });

          expect((sent.init?.body as FormData).get('response_format')).toBe('srt');
          expect(captured).toBe(srt);
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes the result to --out and reports the saved path', async () => {
    const { dir, filePath } = makeTempAudio();
    const outPath = join(dir, 'transcript.txt');

    try {
      await withStubbedFetch(
        () => jsonResponse({ text: 'saved transcript', duration: 3.5 }),
        async () => {
          const captured = await captureLog(async () => {
            await transcribeCommand.execute(baseConfig, {
              ...baseFlags,
              file: filePath,
              out: outPath,
            });
          });

          expect(readFileSync(outPath, 'utf-8')).toBe('saved transcript\n');
          expect(captured).toContain('saved');
          expect(captured).toContain('3.5');
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('saves an srt document byte-exact, without an injected trailing newline', async () => {
    const { dir, filePath } = makeTempAudio();
    const outPath = join(dir, 'talk.srt');
    // Deliberately no trailing newline: the file must keep the API's own bytes.
    const srt = '1\n00:00:00,080 --> 00:00:04,540\nhello';

    try {
      await withStubbedFetch(
        () => new Response(srt, { status: 200, headers: { 'Content-Type': 'text/plain' } }),
        async () => {
          await captureLog(async () => {
            await transcribeCommand.execute(baseConfig, {
              ...baseFlags,
              file: filePath,
              responseFormat: 'srt',
              out: outPath,
            });
          });

          expect(readFileSync(outPath, 'utf-8')).toBe(srt);
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('streams incremental text events to stdout and reports the duration', async () => {
    const { dir, filePath } = makeTempAudio();
    const response = sseResponse([
      { data: '{"index":0,"delta":"你好","finish":false}' },
      { data: '{"index":1,"delta":"世界","finish":false}' },
      { data: '{"index":2,"delta":"","finish":true,"duration":2.25}' },
    ]);

    try {
      await withStubbedFetch(
        () => response,
        async (sent) => {
          let captured = '';
          const stderr = await captureStderr(async () => {
            captured = await captureStdout(async () => {
              await transcribeCommand.execute(baseConfig, {
                ...baseFlags,
                file: filePath,
                stream: true,
              });
            });
          });

          expect((sent.init?.body as FormData).get('stream')).toBe('true');
          expect(captured).toBe('你好世界\n');
          expect(stderr).toContain('[Model: asr-1.0]');
          expect(stderr).toContain('[Duration: 2.25s]');
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('warns on stderr when the stream ends without the final event', async () => {
    const { dir, filePath } = makeTempAudio();
    const response = sseResponse([
      { data: '{"index":0,"delta":"truncated","finish":false}' },
    ]);

    try {
      await withStubbedFetch(
        () => response,
        async () => {
          let captured = '';
          const stderr = await captureStderr(async () => {
            captured = await captureStdout(async () => {
              await transcribeCommand.execute(baseConfig, {
                ...baseFlags,
                file: filePath,
                stream: true,
              });
            });
          });

          expect(captured).toBe('truncated\n');
          expect(stderr).toContain('Stream ended before the final event');
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accumulates streamed text into a single json result under --output json', async () => {
    const { dir, filePath } = makeTempAudio();
    const response = sseResponse([
      { data: '{"index":0,"delta":"par","finish":false}' },
      { data: '{"index":1,"delta":"tial","finish":false}' },
      { data: '{"index":2,"delta":"","finish":true,"duration":1.75}' },
    ]);

    try {
      await withStubbedFetch(
        () => response,
        async () => {
          const captured = await captureStdout(async () => {
            await transcribeCommand.execute(
              { ...baseConfig, output: 'json' as const },
              { ...baseFlags, file: filePath, stream: true },
            );
          });

          const parsed = JSON.parse(captured);
          expect(parsed.text).toBe('partial');
          expect(parsed.duration).toBe(1.75);
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('assembles the transcript by index when events arrive out of order', async () => {
    const { dir, filePath } = makeTempAudio();
    const response = sseResponse([
      { data: '{"index":1,"delta":"world","finish":false}' },
      { data: '{"index":0,"delta":"hello ","finish":false}' },
      { data: '{"index":2,"delta":"","finish":true,"duration":2}' },
    ]);

    try {
      await withStubbedFetch(
        () => response,
        async () => {
          let captured = '';
          const stderr = await captureStderr(async () => {
            captured = await captureStdout(async () => {
              await transcribeCommand.execute(
                { ...baseConfig, output: 'json' as const },
                { ...baseFlags, file: filePath, stream: true },
              );
            });
          });

          expect(JSON.parse(captured).text).toBe('hello world');
          expect(stderr).toContain('out of order');
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
