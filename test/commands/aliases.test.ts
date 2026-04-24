import { describe, it, expect } from 'bun:test';
import { registry } from '../../src/registry';

describe('command aliases', () => {
  it('resolves "search web" same as "search query"', () => {
    const web = registry.resolve(['search', 'web']);
    const query = registry.resolve(['search', 'query']);
    expect(web.command).toBe(query.command);
  });

  it('resolves "speech generate" same as "speech synthesize"', () => {
    const generate = registry.resolve(['speech', 'generate']);
    const synthesize = registry.resolve(['speech', 'synthesize']);
    expect(generate.command).toBe(synthesize.command);
  });
});

describe('text chat --prompt alias', () => {
  it('accepts --prompt as alias for --message via dry run', async () => {
    const { default: chatCommand } = await import('../../src/commands/text/chat');

    let output = '';
    const origLog = console.log;
    console.log = (msg: string) => { output += msg; };

    try {
      await chatCommand.execute(
        { apiKey: 'k', region: 'global', baseUrl: 'https://x', output: 'json', timeout: 10, verbose: false, quiet: false, noColor: true, yes: false, dryRun: true, nonInteractive: true, async: false },
        { prompt: ['Hello from prompt'], quiet: false, verbose: false, noColor: true, yes: false, dryRun: true, help: false, nonInteractive: true, async: false },
      );
      const parsed = JSON.parse(output);
      expect(parsed.request.messages[0].content).toBe('Hello from prompt');
    } finally {
      console.log = origLog;
    }
  });
});

describe('search --query alias', () => {
  it('accepts --query as alias for --q via dry run', async () => {
    const { default: queryCommand } = await import('../../src/commands/search/query');

    let output = '';
    const origLog = console.log;
    console.log = (msg: string) => { output += msg; };

    try {
      await queryCommand.execute(
        { apiKey: 'k', region: 'global', baseUrl: 'https://x', output: 'json', timeout: 10, verbose: false, quiet: false, noColor: true, yes: false, dryRun: true, nonInteractive: true, async: false },
        { query: 'test search', quiet: false, verbose: false, noColor: true, yes: false, dryRun: true, help: false, nonInteractive: true, async: false },
      );
      const parsed = JSON.parse(output);
      expect(parsed.request.q).toBe('test search');
    } finally {
      console.log = origLog;
    }
  });
});

describe('config set positional args', () => {
  it('accepts positional key and value via dry run', async () => {
    const { default: setCommand } = await import('../../src/commands/config/set');

    await expect(
      setCommand.execute(
        { region: 'global', baseUrl: 'https://x', output: 'text', timeout: 10, verbose: false, quiet: false, noColor: true, yes: false, dryRun: true, nonInteractive: true, async: false },
        { _positional: ['output', 'json'], quiet: false, verbose: false, noColor: true, yes: false, dryRun: true, help: false, nonInteractive: true, async: false },
      ),
    ).resolves.toBeUndefined();
  });
});

describe('vision describe --file alias', () => {
  it('accepts --file as alias for --image via dry run', async () => {
    const { default: describeCommand } = await import('../../src/commands/vision/describe');

    let output = '';
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as NodeJS.WriteStream).write = (chunk: unknown) => { output += String(chunk); return true; };

    try {
      await describeCommand.execute(
        { apiKey: 'k', region: 'global', baseUrl: 'https://x', output: 'json', timeout: 10, verbose: false, quiet: false, noColor: true, yes: false, dryRun: true, nonInteractive: true, async: false },
        { file: 'photo.jpg', quiet: false, verbose: false, noColor: true, yes: false, dryRun: true, help: false, nonInteractive: true, async: false },
      );
      const parsed = JSON.parse(output);
      expect(parsed.request.image).toBe('photo.jpg');
    } finally {
      (process.stdout as NodeJS.WriteStream).write = origWrite;
    }
  });
});
