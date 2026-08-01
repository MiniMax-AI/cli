import { describe, it, expect, afterEach } from 'bun:test';
import { default as taskListCommand } from '../../../src/commands/video/task-list';
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

describe('video task list command', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
  });

  it('lists Video Generation V2 tasks with filters', async () => {
    let requestedUrl = '';
    server = createMockServer({
      routes: {
        '/v2/query/video_generation': (req) => {
          requestedUrl = req.url;
          return jsonResponse({
            items: [{ id: 'h3-123', model: 'MiniMax-H3', status: 'succeeded' }],
            total: 1,
          });
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
      await taskListCommand.execute(
        { ...baseConfig, baseUrl: server.url },
        {
          ...baseFlags,
          pageNum: 1,
          pageSize: 20,
          status: 'succeeded',
          taskId: ['h3-123'],
          taskType: 'text_to_video',
        },
      );
    } finally {
      process.stdout.write = originalWrite;
    }

    const url = new URL(requestedUrl);
    expect(url.searchParams.get('page_num')).toBe('1');
    expect(url.searchParams.get('page_size')).toBe('20');
    expect(url.searchParams.get('filter.status')).toBe('succeeded');
    expect(url.searchParams.get('filter.task_ids')).toBe('h3-123');
    expect(url.searchParams.get('filter.model')).toBe('MiniMax-H3');
    expect(url.searchParams.get('filter.task_type')).toBe('text_to_video');
    expect(JSON.parse(output).total).toBe(1);
  });
});
