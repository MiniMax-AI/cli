import { describe, it, expect } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { default as generateCommand } from '../../../src/commands/video/generate';
import type { Config } from '../../../src/config/schema';
import type { GlobalFlags } from '../../../src/types/flags';
import { createMockServer } from '../../helpers/mock-server';

const h3DryRunConfig: Config = {
  apiKey: 'test-key',
  region: 'global',
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

const baseFlags: GlobalFlags = {
  quiet: false,
  verbose: false,
  noColor: true,
  yes: false,
  dryRun: true,
  help: false,
  nonInteractive: true,
  async: false,
};

async function h3DryRun(flags: Partial<GlobalFlags>): Promise<Record<string, unknown>> {
  const originalLog = console.log;
  let output = '';
  console.log = (message: string) => { output += message; };

  try {
    await generateCommand.execute(h3DryRunConfig, {
      ...baseFlags,
      model: 'MiniMax-H3',
      prompt: 'A cinematic test scene',
      ...flags,
    });
    return (JSON.parse(output) as { request: Record<string, unknown> }).request;
  } finally {
    console.log = originalLog;
  }
}

describe('video generate command', () => {
  it('has correct name', () => {
    expect(generateCommand.name).toBe('video generate');
  });

  it('keeps the H3 CLI surface minimal', () => {
    const visibleOptions = generateCommand.options?.filter(option => !option.hidden) ?? [];
    const optionFlags = visibleOptions.map(option => option.flag);
    const legacyFirstFrame = generateCommand.options?.find(
      option => option.flag === '--first-frame <path-or-url>',
    );

    expect(optionFlags).toContain('--reference-image <path-or-url>');
    expect(optionFlags).toContain('--image <path-or-url>');
    expect(optionFlags).not.toContain('--first-frame <path-or-url>');
    expect(optionFlags).not.toContain('--image-role <role>');
    expect(optionFlags).not.toContain('--resolution <resolution>');
    expect(optionFlags).not.toContain('--region <region>');
    expect(legacyFirstFrame?.hidden).toBe(true);
  });

  it('requires prompt', async () => {
    const config = {
      apiKey: 'test-key',
      region: 'global' as const,
      baseUrl: 'https://api.mmx.io',
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
      generateCommand.execute(config, {
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: false,
        help: false,
        nonInteractive: true,
        async: false,
      }),
    ).rejects.toThrow('Missing required argument: --prompt');
  });

  it('uses defaultVideoModel when --model flag is not provided', async () => {
    const config = {
      apiKey: 'test-key',
      region: 'global' as const,
      baseUrl: 'https://api.mmx.io',
      output: 'json' as const,
      timeout: 10,
      defaultVideoModel: 'MiniMax-Hailuo-2.3-6s-768p',
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
      await generateCommand.execute(config, {
        prompt: 'A cat',
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
      expect(parsed.request.model).toBe('MiniMax-Hailuo-2.3-6s-768p');
    } finally {
      console.log = originalLog;
    }
  });

  it('auto-switch (--lastFrame) overrides defaultVideoModel', async () => {
    const config = {
      apiKey: 'test-key',
      region: 'global' as const,
      baseUrl: 'https://api.mmx.io',
      output: 'json' as const,
      timeout: 10,
      defaultVideoModel: 'MiniMax-Hailuo-2.3-6s-768p',
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
      // Use HTTP URLs to avoid file system read
      await generateCommand.execute(config, {
        prompt: 'A cat',
        image: 'https://example.com/first.png',
        lastFrame: 'https://example.com/last.png',
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
      expect(parsed.request.model).toBe('MiniMax-Hailuo-02');
    } finally {
      console.log = originalLog;
    }
  });

  it('--model flag overrides everything', async () => {
    const config = {
      apiKey: 'test-key',
      region: 'global' as const,
      baseUrl: 'https://api.mmx.io',
      output: 'json' as const,
      timeout: 10,
      defaultVideoModel: 'MiniMax-Hailuo-2.3-6s-768p',
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
      await generateCommand.execute(config, {
        prompt: 'A cat',
        model: 'MiniMax-Hailuo-2.3',
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
      expect(parsed.request.model).toBe('MiniMax-Hailuo-2.3');
    } finally {
      console.log = originalLog;
    }
  });

  it('builds a Video Generation V2 request for MiniMax-H3', async () => {
    const config = {
      apiKey: 'test-key',
      region: 'global' as const,
      baseUrl: 'https://api.mmx.io',
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

    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    try {
      await generateCommand.execute(config, {
        prompt: 'Ocean waves at sunset',
        model: 'MiniMax-H3',
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
      expect(parsed.request).toEqual({
        model: 'MiniMax-H3',
        content: [{ type: 'text', text: 'Ocean waves at sunset' }],
        resolution: '2K',
        duration: 5,
        ratio: '16:9',
      });
    } finally {
      console.log = originalLog;
    }
  });

  it('maps H3 reference inputs into typed content items', async () => {
    const config = {
      apiKey: 'test-key',
      region: 'global' as const,
      baseUrl: 'https://api.mmx.io',
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

    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    try {
      await generateCommand.execute(config, {
        prompt: 'Keep the same character and motion',
        model: 'MiniMax-H3',
        referenceImage: ['https://example.com/character.png'],
        referenceVideo: ['https://example.com/motion.mp4'],
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
      expect(parsed.request.content).toEqual([
        { type: 'text', text: 'Keep the same character and motion' },
        {
          type: 'image_url',
          image_url: { url: 'https://example.com/character.png' },
          role: 'reference_image',
        },
        {
          type: 'video_url',
          video_url: { url: 'https://example.com/motion.mp4' },
          role: 'reference_video',
        },
      ]);
      expect(parsed.request.ratio).toBe('adaptive');
    } finally {
      console.log = originalLog;
    }
  });

  it('maps H3 image, last-frame-only, and image-plus-last-frame CLI flags', async () => {
    const inputImage = await h3DryRun({
      image: 'https://example.com/first.png',
    });
    expect(inputImage.content).toEqual([
      { type: 'text', text: 'A cinematic test scene' },
      {
        type: 'image_url',
        image_url: { url: 'https://example.com/first.png' },
        role: 'first_frame',
      },
    ]);

    const lastFrame = await h3DryRun({
      lastFrame: 'https://example.com/last.png',
    });
    expect(lastFrame.content).toEqual([
      { type: 'text', text: 'A cinematic test scene' },
      {
        type: 'image_url',
        image_url: { url: 'https://example.com/last.png' },
        role: 'last_frame',
      },
    ]);

    const firstAndLastFrame = await h3DryRun({
      image: 'https://example.com/first.png',
      lastFrame: 'https://example.com/last.png',
    });
    expect(firstAndLastFrame.content).toEqual([
      { type: 'text', text: 'A cinematic test scene' },
      {
        type: 'image_url',
        image_url: { url: 'https://example.com/first.png' },
        role: 'first_frame',
      },
      {
        type: 'image_url',
        image_url: { url: 'https://example.com/last.png' },
        role: 'last_frame',
      },
    ]);
  });

  it('keeps --first-frame as a hidden alias for --image', async () => {
    const legacyAlias = await h3DryRun({
      firstFrame: 'https://example.com/legacy.png',
    });
    expect(legacyAlias.content).toEqual([
      { type: 'text', text: 'A cinematic test scene' },
      {
        type: 'image_url',
        image_url: { url: 'https://example.com/legacy.png' },
        role: 'first_frame',
      },
    ]);

    await expect(
      generateCommand.execute(h3DryRunConfig, {
        ...baseFlags,
        model: 'MiniMax-H3',
        prompt: 'A cinematic test scene',
        image: 'https://example.com/image.png',
        firstFrame: 'https://example.com/legacy.png',
      }),
    ).rejects.toThrow('--image and --first-frame are aliases');
  });

  it('polls an H3 task and downloads the direct V2 content URL', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'mmx-h3-download-'));
    const outputPath = join(tempDir, 'result.mp4');
    const originalFetch = globalThis.fetch;
    const originalLog = console.log;
    let pollCount = 0;
    let output = '';
    const server = createMockServer({
      routes: {
        '/v2/video_generation': () => new Response(JSON.stringify({ task_id: 'h3-download' }), {
          headers: { 'Content-Type': 'application/json' },
        }),
        '/v2/query/video_generation/h3-download': () => {
          pollCount++;
          return new Response(JSON.stringify({
            task: {
              id: 'h3-download',
              model: 'MiniMax-H3',
              status: pollCount === 1 ? 'running' : 'succeeded',
              ...(pollCount === 1
                ? {}
                : { content: { url: `${server.url}/generated.mp4` } }),
            },
          }), {
            headers: { 'Content-Type': 'application/json' },
          });
        },
        '/generated.mp4': () => new Response('mock-video'),
      },
    });

    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
      const httpsDownloadUrl = `${server.url.replace('http://', 'https://')}/generated.mp4`;
      if (url === httpsDownloadUrl) {
        return originalFetch(`${server.url}/generated.mp4`, init);
      }
      return originalFetch(input, init);
    }) as typeof globalThis.fetch;
    console.log = (message: string) => { output += message; };

    try {
      await generateCommand.execute({
        ...h3DryRunConfig,
        baseUrl: server.url,
        quiet: true,
        dryRun: false,
      }, {
        ...baseFlags,
        prompt: 'Ocean waves',
        model: 'MiniMax-H3',
        duration: 5,
        ratio: '16:9',
        download: outputPath,
        pollInterval: 0,
        quiet: true,
        dryRun: false,
      });

      expect(pollCount).toBe(2);
      expect(readFileSync(outputPath, 'utf8')).toBe('mock-video');
      expect(output).toBe(outputPath);
    } finally {
      globalThis.fetch = originalFetch;
      console.log = originalLog;
      server.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('surfaces H3 task failure details from the V2 query response', async () => {
    const server = createMockServer({
      routes: {
        '/v2/video_generation': () => new Response(JSON.stringify({ task_id: 'h3-failed' }), {
          headers: { 'Content-Type': 'application/json' },
        }),
        '/v2/query/video_generation/h3-failed': () => new Response(JSON.stringify({
          task: {
            id: 'h3-failed',
            model: 'MiniMax-H3',
            status: 'failed',
            error: {
              code: 'H3_FAILED',
              message: 'Reference video could not be decoded',
            },
          },
        }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      },
    });

    try {
      await expect(
        generateCommand.execute({
          ...h3DryRunConfig,
          baseUrl: server.url,
          quiet: true,
          dryRun: false,
        }, {
          ...baseFlags,
          prompt: 'Ocean waves',
          model: 'MiniMax-H3',
          pollInterval: 0,
          quiet: true,
          dryRun: false,
        }),
      ).rejects.toThrow('H3_FAILED: Reference video could not be decoded');
    } finally {
      server.close();
    }
  });

  it('keeps H3-only parameters out of the MiniMax-Hailuo-2.3 path', async () => {
    const config = {
      apiKey: 'test-key',
      region: 'global' as const,
      baseUrl: 'https://api.mmx.io',
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

    await expect(
      generateCommand.execute(config, {
        prompt: 'A cat',
        model: 'MiniMax-Hailuo-2.3',
        duration: 5,
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: true,
        help: false,
        nonInteractive: true,
        async: false,
      }),
    ).rejects.toThrow('require --model MiniMax-H3');
  });

  it('rejects explicit MiniMax-Hailuo-2.3-Fast without --image', async () => {
    const config = {
      apiKey: 'test-key',
      region: 'global' as const,
      baseUrl: 'https://api.mmx.io',
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

    await expect(
      generateCommand.execute(config, {
        prompt: 'A cat',
        model: 'MiniMax-Hailuo-2.3-Fast',
        quiet: false,
        verbose: false,
        noColor: true,
        yes: false,
        dryRun: true,
        help: false,
        nonInteractive: true,
        async: false,
      }),
    ).rejects.toThrow('MiniMax-Hailuo-2.3-Fast only supports I2V');
  });
});
