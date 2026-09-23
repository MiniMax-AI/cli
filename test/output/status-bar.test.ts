import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { maybeShowStatusBar, resetStatusBar } from '../../src/output/status-bar';
import type { Config } from '../../src/config/schema';

const baseConfig: Config = {
  apiKey: 'sk-api-key',
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

describe('status bar', () => {
  const originalWrite = process.stderr.write;
  const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');

  beforeEach(() => {
    resetStatusBar();
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
    if (ttyDescriptor) {
      Object.defineProperty(process.stderr, 'isTTY', ttyDescriptor);
    } else {
      delete (process.stderr as unknown as Record<string, unknown>).isTTY;
    }
    resetStatusBar();
  });

  function captureStatusBar(config: Config): string {
    let output = '';
    process.stderr.write = ((chunk: string | Uint8Array) => {
      output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      return true;
    }) as typeof process.stderr.write;

    maybeShowStatusBar(config, 'sk-123456789', 'MiniMax-M2');
    return output;
  }

  it('omits ANSI escape sequences when noColor is enabled', () => {
    expect(captureStatusBar(baseConfig)).toBe(
      'MINIMAX ~/.mmx/config.json | URL: api.minimax.io | Key: sk-1...6789 (flag) | Model: MiniMax-M2\n',
    );
  });

  it('keeps ANSI styling enabled by default', () => {
    const output = captureStatusBar({ ...baseConfig, noColor: false });

    expect(output).toContain('\x1b[');
    expect(output).toContain('MINIMAX');
    expect(output).toContain('Model:');
  });
});
