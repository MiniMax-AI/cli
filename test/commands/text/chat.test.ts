import { describe, it, expect, afterEach } from 'bun:test';
import { resetStatusBar } from '../../../src/client/http';
import { createMockServer, jsonResponse, sseResponse, type MockServer } from '../../helpers/mock-server';
import textChatResponse from '../../fixtures/text-chat-response.json';
import type { Config } from '../../../src/config/schema';

describe('text chat command', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
    resetStatusBar();
  });

  it('sends chat request and gets response', async () => {
    server = createMockServer({
      routes: {
        '/anthropic/v1/messages': () => jsonResponse(textChatResponse),
      },
    });

    // Test via module import
    const { default: chatCommand } = await import('../../../src/commands/text/chat');

    const config: Config = {
      apiKey: 'test-key',
      region: 'global' as const,
      baseUrl: server.url,
      output: 'json',
      timeout: 10,
      verbose: false,
      quiet: true,
      noColor: true,
      yes: false,
      dryRun: false,
      nonInteractive: false,
      async: false,
    };

    // Capture output
    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    try {
      await chatCommand.execute(config, {
        message: ['Hello'],
        stream: false,
        quiet: true,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: false,
        help: false,
        nonInteractive: false,
        async: false,
      });

      expect(output).toContain('Hello! How can I help you today?');
    } finally {
      console.log = originalLog;
    }
  });

  it('shows dry run output', async () => {
    const { default: chatCommand } = await import('../../../src/commands/text/chat');

    const config: Config = {
      apiKey: 'test-key',
      region: 'global' as const,
      baseUrl: 'https://api.minimax.io',
      output: 'json',
      timeout: 10,
      verbose: false,
      quiet: true,
      noColor: true,
      yes: false,
      dryRun: true,
      nonInteractive: false,
      async: false,
    };

    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    try {
      await chatCommand.execute(config, {
        message: ['Hello'],
        quiet: true,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: true,
        help: false,
        nonInteractive: false,
        async: false,
      });

      const parsed = JSON.parse(output);
      expect(parsed.request.model).toBe('MiniMax-M2.7');
      expect(parsed.request.messages).toHaveLength(1);
    } finally {
      console.log = originalLog;
    }
  });
});
