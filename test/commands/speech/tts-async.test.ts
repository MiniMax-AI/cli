import { describe, it, expect } from 'bun:test';
import { registry } from '../../../src/registry';

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
      expect(parsed.request.output_format).toBeUndefined();
    } finally {
      console.log = origLog;
    }
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
