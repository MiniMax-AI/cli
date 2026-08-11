import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, truncateSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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
      expect(parsed.request.model).toBe('MiniMax-M3');
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
      defaultTextModel: 'MiniMax-M3',
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
      expect(parsed.request.model).toBe('MiniMax-M3');
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
      defaultTextModel: 'MiniMax-M3',
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

  describe('--image', () => {
    // 1x1 transparent PNG
    const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const dir = mkdtempSync(join(tmpdir(), 'mmx-chat-image-'));
    const imgA = join(dir, 'a.png');
    const imgB = join(dir, 'b.png');
    writeFileSync(imgA, Buffer.from(PNG_BASE64, 'base64'));
    writeFileSync(imgB, Buffer.from(PNG_BASE64, 'base64'));

    const baseConfig: Config = {
      apiKey: 'test-key',
      region: 'global' as const,
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

    const baseFlags = {
      quiet: false,
      verbose: false,
      noColor: true,
      yes: false,
      dryRun: true,
      help: false,
      nonInteractive: true,
      async: false,
    };

    async function dryRunRequest(config: Config, flags: Record<string, unknown>) {
      const { default: chatCommand } = await import('../../../src/commands/text/chat');
      const originalLog = console.log;
      let output = '';
      console.log = (msg: string) => { output += msg; };
      try {
        await chatCommand.execute(config, { ...baseFlags, ...flags } as never);
      } finally {
        console.log = originalLog;
      }
      return JSON.parse(output).request;
    }

    it('appends Anthropic-shaped image blocks to the user message', async () => {
      const request = await dryRunRequest(baseConfig, {
        message: ['What is this?'],
        image: [imgA],
      });

      expect(request.messages).toHaveLength(1);
      expect(request.messages[0].content).toEqual([
        { type: 'text', text: 'What is this?' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_BASE64 } },
      ]);
    });

    it('supports multiple images in one message', async () => {
      const request = await dryRunRequest(baseConfig, {
        message: ['Compare these.'],
        image: [imgA, imgB],
      });

      const blocks = request.messages[0].content;
      expect(blocks).toHaveLength(3);
      expect(blocks.filter((b: { type: string }) => b.type === 'image')).toHaveLength(2);
    });

    it('sends images with no --message', async () => {
      const request = await dryRunRequest(baseConfig, { image: [imgA] });

      expect(request.messages).toHaveLength(1);
      expect(request.messages[0].role).toBe('user');
      expect(request.messages[0].content).toEqual([
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_BASE64 } },
      ]);
    });

    it('overrides a text-only defaultTextModel with MiniMax-M3', async () => {
      const request = await dryRunRequest(
        { ...baseConfig, defaultTextModel: 'MiniMax-Text-01' },
        { message: ['What is this?'], image: [imgA] },
      );

      expect(request.model).toBe('MiniMax-M3');
    });

    it('still honours an explicit --model', async () => {
      const request = await dryRunRequest(
        { ...baseConfig, defaultTextModel: 'MiniMax-Text-01' },
        { message: ['What is this?'], image: [imgA], model: 'MiniMax-VL-01' },
      );

      expect(request.model).toBe('MiniMax-VL-01');
    });

    it('errors on a missing image file', async () => {
      await expect(
        dryRunRequest(baseConfig, { message: ['hi'], image: [join(dir, 'nope.png')] }),
      ).rejects.toThrow(/File not found/);
    });

    it('rejects an oversized local image', async () => {
      const big = join(dir, 'big.png');
      writeFileSync(big, '');
      truncateSync(big, 11 * 1024 * 1024);

      await expect(
        dryRunRequest(baseConfig, { message: ['hi'], image: [big] }),
      ).rejects.toThrow(/too large/i);
    });

    it('rejects HEIC images for chat', async () => {
      const heic = join(dir, 'photo.heic');
      writeFileSync(heic, Buffer.from('not really heic'));

      await expect(
        dryRunRequest(baseConfig, { message: ['hi'], image: [heic] }),
      ).rejects.toThrow(/Unsupported image format/);
    });

    it('accepts GIF images for chat', async () => {
      const gif = join(dir, 'a.gif');
      writeFileSync(gif, Buffer.from('GIF89a'));

      const request = await dryRunRequest(baseConfig, { message: ['hi'], image: [gif] });
      const block = request.messages[0].content.find((b: { type: string }) => b.type === 'image');
      expect(block.source.media_type).toBe('image/gif');
    });

    it('rejects a remote image over 10 MB via content-length', async () => {
      const imgServer = createMockServer({
        routes: {
          '/big.png': () => new Response(Buffer.alloc(11 * 1024 * 1024), {
            headers: { 'Content-Type': 'image/png' },
          }),
        },
      });

      try {
        await expect(
          dryRunRequest(baseConfig, { message: ['hi'], image: [`${imgServer.url}/big.png`] }),
        ).rejects.toThrow(/too large/i);
      } finally {
        imgServer.close();
      }
    });

    it('rejects a data: URI image over the per-image cap', async () => {
      const oversized = 'A'.repeat(Math.ceil((11 * 1024 * 1024) / 3) * 4);

      await expect(
        dryRunRequest(baseConfig, { message: ['hi'], image: [`data:image/png;base64,${oversized}`] }),
      ).rejects.toThrow(/too large/i);
    });

    it('rejects when images cumulatively exceed the 64 MB request cap', async () => {
      // ~7.15 MB decoded each — under the 10 MB per-image cap, but seven of
      // them push the whole request past the 64 MB aggregate cap.
      const chunk = 'A'.repeat(10_000_000);
      const images = Array.from({ length: 7 }, () => `data:image/png;base64,${chunk}`);

      await expect(
        dryRunRequest(baseConfig, { message: ['hi'], image: images }),
      ).rejects.toThrow(/64 MB/);
    });
  });
});
