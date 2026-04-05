import { describe, it, expect, afterEach } from 'bun:test';
import { default as taskGetCommand } from '../../../src/commands/video/task-get';
import { createMockServer, jsonResponse, type MockServer } from '../../helpers/mock-server';
import videoTaskSuccess from '../../fixtures/video-task-success.json';

describe('video task get command', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
  });

  it('has correct name', () => {
    expect(taskGetCommand.name).toBe('video task get');
  });

  it('requires task-id', async () => {
    const config = {
      apiKey: 'test-key',
      region: 'global' as const,
      baseUrl: 'https://api.minimax.io',
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

    await expect(
      taskGetCommand.execute(config, {
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: false,
        help: false,
        nonInteractive: true,
        async: false,
      }),
    ).rejects.toThrow('--task-id is required');
  });

  it('queries task status', async () => {
    server = createMockServer({
      routes: {
        '/v1/query/video_generation': () => jsonResponse(videoTaskSuccess),
      },
    });

    const config = {
      apiKey: 'test-key',
      region: 'global' as const,
      baseUrl: server.url,
      output: 'json' as const,
      timeout: 10,
      verbose: false,
      quiet: false,
      noColor: true,
      yes: false,
      dryRun: false,
      nonInteractive: true,
      async: false,
    };

    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    try {
      await taskGetCommand.execute(config, {
        taskId: '106916112212032',
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: false,
        help: false,
        nonInteractive: true,
        async: false,
      });

      const parsed = JSON.parse(output);
      expect(parsed.status).toBe('Success');
      expect(parsed.file_id).toBe('176844028768320');
    } finally {
      console.log = originalLog;
    }
  });
});
