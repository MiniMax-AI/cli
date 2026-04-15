import { describe, it, expect, afterEach } from 'bun:test';
import { createMockServer, jsonResponse, sseResponse, type MockServer } from '../../helpers/mock-server';
import textChatResponse from '../../fixtures/text-chat-response.json';
import type { Config } from '../../../src/config/schema';

describe('text chat command', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
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
      platformHost: 'https://platform.minimax.io',
      oauthApiHost: 'https://account.minimax.io',
      baseUrl: server.url,
      output: 'json',
      timeout: 10,
      verbose: false,
      quiet: true,
      noColor: true,
      yes: false,
      dryRun: false,
      nonInteractive: true,
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
        nonInteractive: true,
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
      platformHost: 'https://platform.minimax.io',
      oauthApiHost: 'https://account.minimax.io',
      baseUrl: 'https://api.mmx.io',
      output: 'json',
      timeout: 10,
      verbose: false,
      quiet: false,
      noColor: true,
      yes: false,
      dryRun: true,
      nonInteractive: true,
      async: false,
    };

    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    try {
      await chatCommand.execute(config, {
        message: ['Hello'],
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: true,
        help: false,
        nonInteractive: true,
        async: false,
      });

      const parsed = JSON.parse(output);
      expect(parsed.request.model).toBe('MiniMax-M2.7');
      expect(parsed.request.messages).toHaveLength(1);
    } finally {
      console.log = originalLog;
    }
  });

  it('uses defaultTextModel when --model flag is not provided', async () => {
    const { default: chatCommand } = await import('../../../src/commands/text/chat');

    const config: Config = {
      apiKey: 'test-key',
      region: 'global' as const,
      baseUrl: 'https://api.mmx.io',
      output: 'json',
      timeout: 10,
      defaultTextModel: 'MiniMax-M2.7-highspeed',
      verbose: false,
      quiet: false,
      noColor: true,
      yes: false,
      dryRun: true,
      nonInteractive: true,
      async: false,
    };

    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    try {
      await chatCommand.execute(config, {
        message: ['Hello'],
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: true,
        help: false,
        nonInteractive: true,
        async: false,
      });

      const parsed = JSON.parse(output);
      expect(parsed.request.model).toBe('MiniMax-M2.7-highspeed');
    } finally {
      console.log = originalLog;
    }
  });

  it('does not enable default streaming for json output', async () => {
    let requestBody: { stream?: boolean } | undefined;
    server = createMockServer({
      routes: {
        '/anthropic/v1/messages': async (req) => {
          requestBody = await req.json() as { stream?: boolean };
          return jsonResponse(textChatResponse);
        },
      },
    });

    const { default: chatCommand } = await import('../../../src/commands/text/chat');

    const config: Config = {
      apiKey: 'test-key',
      region: 'global' as const,
      baseUrl: server.url,
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

    const originalIsTTY = process.stdout.isTTY;
    const originalLog = console.log;
    let output = '';
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    console.log = (msg: string) => { output += msg; };

    try {
      await chatCommand.execute(config, {
        message: ['Hello'],
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: false,
        help: false,
        nonInteractive: true,
        async: false,
      });

      expect(requestBody?.stream).toBe(false);
      expect(JSON.parse(output).content[0].text).toBe('Hello! How can I help you today?');
    } finally {
      console.log = originalLog;
      Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
    }
  });

  it('emits only final json to stdout for explicit stream json output', async () => {
    server = createMockServer({
      routes: {
        '/anthropic/v1/messages': () => sseResponse([
          { data: JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }) },
          { data: JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } }) },
        ]),
      },
    });

    const { default: chatCommand } = await import('../../../src/commands/text/chat');

    const config: Config = {
      apiKey: 'test-key',
      region: 'global' as const,
      baseUrl: server.url,
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

    const originalLog = console.log;
    const originalWrite = process.stdout.write;
    let output = '';
    console.log = (msg: string) => { output += `${msg}\n`; };
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
      return true;
    }) as typeof process.stdout.write;

    try {
      await chatCommand.execute(config, {
        message: ['Hello'],
        stream: true,
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: false,
        help: false,
        nonInteractive: true,
        async: false,
      });

      expect(output).toBe('{\n  "content": "Hello world"\n}\n');
      expect(JSON.parse(output).content).toBe('Hello world');
    } finally {
      console.log = originalLog;
      process.stdout.write = originalWrite;
    }
  });

  it('--model flag overrides defaultTextModel', async () => {
    const { default: chatCommand } = await import('../../../src/commands/text/chat');

    const config: Config = {
      apiKey: 'test-key',
      region: 'global' as const,
      baseUrl: 'https://api.mmx.io',
      output: 'json',
      timeout: 10,
      defaultTextModel: 'MiniMax-M2.7-highspeed',
      verbose: false,
      quiet: false,
      noColor: true,
      yes: false,
      dryRun: true,
      nonInteractive: true,
      async: false,
    };

    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    try {
      await chatCommand.execute(config, {
        message: ['Hello'],
        model: 'MiniMax-M2.7',
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: true,
        help: false,
        nonInteractive: true,
        async: false,
      });

      const parsed = JSON.parse(output);
      expect(parsed.request.model).toBe('MiniMax-M2.7');
    } finally {
      console.log = originalLog;
    }
  });
});
