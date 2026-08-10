import { describe, it, expect, afterEach } from 'bun:test';
import { default as taskDeleteCommand } from '../../../src/commands/video/task-delete';
import { createMockServer, jsonResponse, type MockServer } from '../../helpers/mock-server';
import type { Config } from '../../../src/config/schema';
import type { GlobalFlags } from '../../../src/types/flags';

const baseConfig: Config = {
  apiKey: 'test-key',
  region: 'global',
  baseUrl: 'https://api.mmx.io',
  output: 'json',
  timeout: 10,
  verbose: false,
  quiet: false,
  noColor: true,
  yes: false,
  dryRun: false,
  nonInteractive: true,
  async: false,
};

const baseFlags: GlobalFlags = {
  quiet: false,
  verbose: false,
  noColor: true,
  yes: false,
  dryRun: false,
  help: false,
  nonInteractive: true,
  async: false,
};

describe('video task delete command', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
  });

  it('requires task-id', async () => {
    await expect(taskDeleteCommand.execute(baseConfig, baseFlags))
      .rejects.toThrow('--task-id is required');
  });

  it('deletes a Video Generation V2 task', async () => {
    let method = '';
    server = createMockServer({
      routes: {
        '/v2/video_generation/h3-123': (req) => {
          method = req.method;
          return jsonResponse({ task_id: 'h3-123', action: 'delete', status: 'deleted' });
        },
      },
    });

    let output = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      output += chunk;
      return true;
    }) as typeof process.stdout.write;

    try {
      await taskDeleteCommand.execute(
        { ...baseConfig, baseUrl: server.url },
        { ...baseFlags, taskId: 'h3-123' },
      );
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(method).toBe('DELETE');
    expect(JSON.parse(output)).toEqual({
      task_id: 'h3-123',
      action: 'delete',
      status: 'deleted',
    });
  });
});
