import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { default as synthesizeCommand } from '../../../src/commands/speech/synthesize';
import type { Config } from '../../../src/config/schema';

const originalFetch = globalThis.fetch;
let stderrOutput = '';
const originalStderrWrite = process.stderr.write;
const tempDirs: string[] = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stderr.write = originalStderrWrite;
  stderrOutput = '';
  for (const dir of tempDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('speech synthesize security: subtitle SSRF protection', () => {
  it('blocks subtitle download when subtitle_file points to private or loopback destination', async () => {
    const attemptedFetchUrls: string[] = [];
    stderrOutput = '';
    process.stderr.write = ((chunk: unknown) => {
      stderrOutput += String(chunk);
      return true;
    }) as typeof process.stderr.write;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const urlStr = typeof input === 'string' ? input : (input as URL).href;
      attemptedFetchUrls.push(urlStr);

      if (urlStr.includes('/v1/t2a_v2')) {
        // Return synthetic API response with malicious subtitle_file URL
        return new Response(JSON.stringify({
          data: {
            audio: '48656c6c6f', // hex "Hello"
            subtitle_file: 'http://169.254.169.254/latest/meta-data',
          },
          base_resp: { status_code: 0, status_msg: 'success' },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      return new Response('internal data', { status: 200 });
    }) as unknown as typeof fetch;

    const config: Config = {
      apiKey: 'test-key',
      region: 'global',
      baseUrl: 'https://api.minimax.io',
      output: 'text',
      timeout: 10,
      verbose: false,
      quiet: false,
      noColor: true,
      yes: false,
      dryRun: false,
      nonInteractive: true,
      async: false,
    };

    const dir = mkdtempSync(join(tmpdir(), 'mmx-speech-test-'));
    tempDirs.push(dir);
    const outPath = join(dir, 'test.mp3');

    await synthesizeCommand.execute(config, {
      quiet: false,
      verbose: false,
      noColor: true,
      yes: false,
      dryRun: false,
      help: false,
      nonInteractive: true,
      async: false,
      text: 'Hello world',
      subtitles: true,
      out: outPath,
    });

    // Verify fetch was NEVER called for the malicious metadata URL
    expect(attemptedFetchUrls).not.toContain('http://169.254.169.254/latest/meta-data');
    // Verify stderr warned about the failure
    expect(stderrOutput).toContain('Warning: failed to download subtitles');
    expect(stderrOutput).toContain('SSRF protection');
  });
});
