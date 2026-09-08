import { afterEach, describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registry } from '../../../src/registry';
import { createMockServer, jsonResponse, type MockServer } from '../../helpers/mock-server';

const originalFetch = globalThis.fetch;

const baseConfig = {
  apiKey: 'k',
  region: 'global' as const,
  baseUrl: 'https://api.minimax.io',
  output: 'json' as const,
  timeout: 10,
  verbose: false,
  quiet: false,
  noColor: true,
  yes: false,
  dryRun: true,
  nonInteractive: true,
  async: false,
};

describe('speech async command', () => {
  let server: MockServer;
  let tempDir: string | undefined;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    server?.close();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('is registered and prints the request body on dry run', async () => {
    const { command } = registry.resolve(['speech', 'async']);
    expect(command.name).toBe('speech async');

    let output = '';
    const origLog = console.log;
    console.log = (msg: string) => { output += msg; };

    try {
      await command.execute(
        baseConfig,
        { model: 'speech-2.8-hd', text: 'Hello world', quiet: false, verbose: false, noColor: true, yes: false, dryRun: true, help: false, nonInteractive: true, async: false },
      );
      const parsed = JSON.parse(output);
      expect(parsed.request.model).toBe('speech-2.8-hd');
      expect(parsed.request.text).toBe('Hello world');
      expect(parsed.request.audio_setting.audio_sample_rate).toBe(32000);
      expect(parsed.request.audio_setting.sample_rate).toBeUndefined();
      expect(parsed.request.output_format).toBeUndefined();
    } finally {
      console.log = origLog;
    }
  });

  it('uploads --text-file for long-form synthesis', async () => {
    const upload = { purpose: null as FormDataEntryValue | null };
    let requestBody: Record<string, unknown> | undefined;
    server = createMockServer({
      routes: {
        '/v1/files/upload': async (req) => {
          const form = await req.formData();
          upload.purpose = form.get('purpose');
          return jsonResponse({
            file: { file_id: 'file-123', bytes: 12, created_at: 1, filename: 'long.txt', purpose: upload.purpose },
            base_resp: { status_code: 0, status_msg: 'success' },
          });
        },
        '/v1/t2a_async_v2': async (req) => {
          requestBody = await req.json() as Record<string, unknown>;
          return jsonResponse({
            task_id: 123,
            base_resp: { status_code: 0, status_msg: 'success' },
          });
        },
      },
    });
    tempDir = mkdtempSync(join(tmpdir(), 'mmx-speech-async-'));
    const textFile = join(tempDir, 'long.txt');
    writeFileSync(textFile, 'Long content');

    const { command } = registry.resolve(['speech', 'async']);
    await command.execute(
      { ...baseConfig, baseUrl: server.url, dryRun: false, quiet: true },
      { textFile, quiet: true, verbose: false, noColor: true, yes: false, dryRun: false, help: false, nonInteractive: true, async: false },
    );

    expect(upload.purpose).toBe('t2a_async_input');
    expect(requestBody?.text_file_id).toBe('file-123');
    expect(requestBody?.text).toBeUndefined();
  });

  it('rejects direct text over 50,000 characters', async () => {
    const { command } = registry.resolve(['speech', 'async']);
    await expect(command.execute(
      baseConfig,
      { text: 'x'.repeat(50_001), quiet: true, verbose: false, noColor: true, yes: false, dryRun: true, help: false, nonInteractive: true, async: false },
    )).rejects.toThrow('Use --text-file for longer input');
  });

  it('authenticates the completed task download', async () => {
    const download = { authorization: null as string | null };
    const query = { method: '', body: undefined as Record<string, unknown> | undefined };
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/v1/t2a_async_v2') {
        return jsonResponse({ task_id: 123, base_resp: { status_code: 0 } });
      }
      if (url.pathname === '/v1/query/t2a_async_query_v2') {
        query.method = init?.method ?? 'GET';
        query.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({
          task_id: 123,
          status: 'Success',
          file_id: 456,
          base_resp: { status_code: 0 },
        });
      }
      if (url.pathname === '/v1/files/retrieve_content') {
        download.authorization = new Headers(init?.headers).get('Authorization');
        return new Response('audio');
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    tempDir = mkdtempSync(join(tmpdir(), 'mmx-speech-async-'));
    const outPath = join(tempDir, 'speech.mp3');
    const { command } = registry.resolve(['speech', 'async']);
    await command.execute(
      { ...baseConfig, baseUrl: 'https://api.example.test', dryRun: false, quiet: true },
      { text: 'Hello', wait: true, out: outPath, pollInterval: 0, quiet: true, verbose: false, noColor: true, yes: false, dryRun: false, help: false, nonInteractive: true, async: false },
    );

    expect(download.authorization).toBe('Bearer k');
    expect(query.method).toBe('POST');
    expect(query.body).toEqual({ task_id: 123 });
  });
});

describe('speech task get command', () => {
  it('is registered and prints the task id on dry run', async () => {
    const { command } = registry.resolve(['speech', 'task', 'get']);
    expect(command.name).toBe('speech task get');

    let output = '';
    const origLog = console.log;
    console.log = (msg: string) => { output += msg; };

    try {
      await command.execute(
        baseConfig,
        { taskId: '95157322514444', quiet: false, verbose: false, noColor: true, yes: false, dryRun: true, help: false, nonInteractive: true, async: false },
      );
      expect(output).toContain('95157322514444');
    } finally {
      console.log = origLog;
    }
  });

  it('requires --task-id', async () => {
    const { command } = registry.resolve(['speech', 'task', 'get']);
    await expect(
      command.execute(
        baseConfig,
        { quiet: false, verbose: false, noColor: true, yes: false, dryRun: true, help: false, nonInteractive: true, async: false },
      ),
    ).rejects.toThrow('--task-id is required');
  });

  it('queries the task with a POST body', async () => {
    const query = { method: '', body: undefined as Record<string, unknown> | undefined };
    const taskServer = createMockServer({
      routes: {
        '/v1/query/t2a_async_query_v2': async (req) => {
          query.method = req.method;
          query.body = await req.json() as Record<string, unknown>;
          return jsonResponse({
            task_id: 123,
            status: 'Processing',
            base_resp: { status_code: 0 },
          });
        },
      },
    });

    try {
      const { command } = registry.resolve(['speech', 'task', 'get']);
      await command.execute(
        { ...baseConfig, baseUrl: taskServer.url, dryRun: false, quiet: true },
        { taskId: '123', quiet: true, verbose: false, noColor: true, yes: false, dryRun: false, help: false, nonInteractive: true, async: false },
      );
    } finally {
      taskServer.close();
    }

    expect(query.method).toBe('POST');
    expect(query.body).toEqual({ task_id: '123' });
  });
});

describe('speech websocket command', () => {
  it('is registered and prints the request body on dry run', async () => {
    const { command } = registry.resolve(['speech', 'websocket']);
    expect(command.name).toBe('speech websocket');

    let output = '';
    const origLog = console.log;
    console.log = (msg: string) => { output += msg; };

    try {
      await command.execute(
        baseConfig,
        { model: 'speech-2.8-hd', text: 'Hello world', quiet: false, verbose: false, noColor: true, yes: false, dryRun: true, help: false, nonInteractive: true, async: false },
      );
      const parsed = JSON.parse(output);
      expect(parsed.request.model).toBe('speech-2.8-hd');
      expect(parsed.request.text).toBe('Hello world');
    } finally {
      console.log = origLog;
    }
  });
});
