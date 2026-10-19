import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import setupCommand from '../../../src/commands/agent/setup';
import { ExitCode } from '../../../src/errors/codes';
import { registry } from '../../../src/registry';
import type { Config } from '../../../src/config/schema';
import type { GlobalFlags } from '../../../src/types/flags';

function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    region: 'cn',
    baseUrl: 'https://api.minimax.cn',
    output: 'json',
    timeout: 30,
    verbose: false,
    quiet: true,
    noColor: true,
    yes: false,
    dryRun: true,
    nonInteractive: true,
    async: false,
    ...overrides,
  };
}

function testFlags(overrides: Partial<GlobalFlags> = {}): GlobalFlags {
  return {
    quiet: false,
    verbose: false,
    noColor: false,
    yes: false,
    dryRun: true,
    help: false,
    nonInteractive: false,
    async: false,
    ...overrides,
  };
}

async function captureConsoleLog(task: () => Promise<void>): Promise<string> {
  const originalLog = console.log;
  let output = '';
  console.log = (message: string) => { output += message; };
  try {
    await task();
    return output;
  } finally {
    console.log = originalLog;
  }
}

describe('agent setup command', () => {
  let home: string;
  let originalHome: string | undefined;
  let originalCodexHome: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mmx-agent-command-'));
    originalHome = process.env.HOME;
    originalCodexHome = process.env.CODEX_HOME;
    process.env.HOME = home;
    process.env.CODEX_HOME = join(home, '.codex');
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('is registered under agent setup', () => {
    expect(registry.resolve(['agent', 'setup']).command).toBe(setupCommand);
  });

  it('explains the supported credentials in command help metadata', () => {
    expect(setupCommand.description).toContain('using a MiniMax API key');
    const apiKeyOption = setupCommand.options?.find(option => option.flag === '--api-key <key>');
    expect(apiKeyOption?.description).toContain('Token Plan (sk-cp)');
    expect(apiKeyOption?.description).toContain('pay-as-you-go (sk-api)');
    expect(apiKeyOption?.description).toContain('not interchangeable');
    expect(setupCommand.options?.some(option => option.flag === '--skip-verify')).toBe(false);
  });

  it('supports scriptable dry-run output without exposing the key', async () => {
    const output = await captureConsoleLog(() => setupCommand.execute(
      testConfig(),
      testFlags({
        agent: ['codex'],
        apiKey: 'sk-test-secret',
        region: 'cn',
        output: 'json',
      }),
    ));

    const parsed = JSON.parse(output);
    expect(parsed.agents).toEqual(['codex']);
    expect(parsed.files[0].status).toBe('would-configure');
    expect(output).not.toContain('sk-test-secret');
    expect(output).not.toContain('\x1b');
  });

  it('accepts an explicit 1M M3.1 window for supported agents', async () => {
    const originalClaudeConfig = process.env.CLAUDE_CONFIG_DIR;
    const originalOpenCodeConfig = process.env.OPENCODE_CONFIG;
    process.env.CLAUDE_CONFIG_DIR = join(home, '.claude');
    process.env.OPENCODE_CONFIG = join(home, 'opencode.json');
    let output: string;
    try {
      output = await captureConsoleLog(() => setupCommand.execute(
        testConfig(),
        testFlags({
          agent: ['claude-code', 'codex', 'opencode'],
          apiKey: 'sk-test-secret',
          region: 'cn',
          m31ContextWindow: '1m',
          output: 'json',
        }),
      ));
    } finally {
      if (originalClaudeConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfig;
      if (originalOpenCodeConfig === undefined) delete process.env.OPENCODE_CONFIG;
      else process.env.OPENCODE_CONFIG = originalOpenCodeConfig;
    }

    const parsed = JSON.parse(output);
    expect(parsed.agents).toEqual(['claude-code', 'codex', 'opencode']);
    expect(parsed.files.every((file: { status: string }) => file.status === 'would-configure'))
      .toBe(true);
  });

  it('rejects invalid M3.1 window values and agents without a window selector', async () => {
    await expect(setupCommand.execute(
      testConfig(),
      testFlags({ agent: ['codex'], apiKey: 'sk-test-secret', region: 'cn', m31ContextWindow: '900k' }),
    )).rejects.toThrow('Invalid --m31-context-window value');
    await expect(setupCommand.execute(
      testConfig(),
      testFlags({ agent: ['hermes'], apiKey: 'sk-test-secret', region: 'cn', m31ContextWindow: '1m' }),
    )).rejects.toThrow('--m31-context-window requires Claude Code, Codex, or OpenCode');
  });

  it('requires an explicit region for scripts', async () => {
    await expect(setupCommand.execute(
      testConfig({ region: 'global', baseUrl: 'https://api.minimax.io' }),
      testFlags({
        agent: ['codex'],
        apiKey: 'sk-test-secret',
      }),
    )).rejects.toThrow('--region global|cn is required');
  });

  it('requires an API key for agent setup', async () => {
    await expect(setupCommand.execute(
      testConfig(),
      testFlags({
        agent: ['codex'],
        region: 'cn',
      }),
    )).rejects.toThrow('A MiniMax API key is required');
  });

  it('reuses an existing Codex MiniMax provider key when no key is passed', async () => {
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(
      join(home, '.codex', 'config.toml'),
      '[model_providers.minimax]\nexperimental_bearer_token = "sk-api-existing-key"\n',
    );

    const output = await captureConsoleLog(() => setupCommand.execute(
      testConfig(),
      testFlags({
        agent: ['codex'],
        region: 'cn',
        output: 'json',
      }),
    ));

    const parsed = JSON.parse(output);
    expect(parsed.verification.status).toBe('skipped');
    expect(output).not.toContain('sk-api-existing-key');
  });

  it('reuses an existing Codex key from a UTF-8 BOM config', async () => {
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(
      join(home, '.codex', 'config.toml'),
      '\ufeff[model_providers.minimax]\nexperimental_bearer_token = "sk-cp-existing-key"\n',
    );

    const output = await captureConsoleLog(() => setupCommand.execute(
      testConfig(),
      testFlags({ agent: ['codex'], region: 'cn', output: 'json' }),
    ));

    expect(JSON.parse(output).verification.model).toBe('MiniMax-M3.1-Flash-Preview');
    expect(output).not.toContain('sk-cp-existing-key');
  });

  it('does not reuse an API key saved for mmx', async () => {
    await expect(setupCommand.execute(
      testConfig({ fileApiKey: 'sk-saved-mmx-key' }),
      testFlags({
        agent: ['codex'],
        region: 'cn',
      }),
    )).rejects.toThrow('A MiniMax API key is required');
  });

  it('routes the shorthand agent command without invoking global auth setup', async () => {
    const child = Bun.spawn({
      cmd: [process.execPath, 'run', 'src/main.ts', 'agent', '--non-interactive', '--dry-run'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: home,
        MMX_CONFIG_DIR: join(home, '.mmx'),
        NO_COLOR: '1',
      },
      stdout: 'ignore',
      stderr: 'pipe',
    });
    const stderr = await new Response(child.stderr).text();
    await child.exited;

    expect(stderr).toContain('At least one --agent or --all is required');
    expect(stderr).not.toContain('How would you like to authenticate');
  });

  it('shows setup options for the shorthand agent help', async () => {
    const child = Bun.spawn({
      cmd: [process.execPath, 'run', 'src/main.ts', 'agent', '--help'],
      cwd: process.cwd(),
      env: { ...process.env, HOME: home, MMX_CONFIG_DIR: join(home, '.mmx'), NO_COLOR: '1' },
      stdout: 'ignore',
      stderr: 'pipe',
    });
    const stderr = await new Response(child.stderr).text();
    await child.exited;

    expect(stderr).toContain('Usage: mmx agent setup');
    expect(stderr).toContain('--api-key <key>');
    expect(stderr).toContain('--m31-context-window <size>');
    expect(stderr).toContain('not interchangeable');
  });

  it('reports an unreachable configured proxy and exits without a generic fetch error', async () => {
    const configDir = join(home, '.mmx');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      proxy: 'http://127.0.0.1:1',
    }));
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        'run',
        'src/main.ts',
        'agent',
        'setup',
        '--agent',
        'codex',
        '--api-key',
        'sk-cp-test-only',
        '--region',
        'cn',
        '--non-interactive',
        '--timeout',
        '1',
      ],
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: home,
        MMX_CONFIG_DIR: configDir,
        MINIMAX_OUTPUT: 'text',
        NO_COLOR: '1',
        HTTPS_PROXY: '',
        https_proxy: '',
        HTTP_PROXY: '',
        http_proxy: '',
        ALL_PROXY: '',
        all_proxy: '',
      },
      stdout: 'ignore',
      stderr: 'pipe',
    });
    const stderr = await new Response(child.stderr).text();

    const acceptableExitCodes: number[] = [ExitCode.NETWORK, ExitCode.TIMEOUT];
    expect(acceptableExitCodes).toContain(await child.exited);
    expect(stderr).toContain('configured proxy');
    expect(stderr).toContain('No agent configuration files were changed.');
    expect(stderr).not.toContain('fetch failed');
  });

  it('keeps non-interactive text output free of prompt colors', async () => {
    const output = await captureConsoleLog(() => setupCommand.execute(
      testConfig({ output: 'text', noColor: false }),
      testFlags({
        agent: ['codex'],
        apiKey: 'sk-test-secret',
        region: 'cn',
        output: 'text',
      }),
    ));

    expect(output).not.toContain('\x1b');
  });

  it('does not enter the wizard when an option was explicitly set to false', async () => {
    await expect(setupCommand.execute(
      testConfig({
        region: 'global',
        baseUrl: 'https://api.minimax.io',
        dryRun: false,
        nonInteractive: false,
      }),
      testFlags({
        dryRun: false,
        _hasExplicitOptions: true,
      }),
    )).rejects.toThrow('At least one --agent or --all is required');
  });

  it('rejects positional agent names instead of silently ignoring them', async () => {
    await expect(setupCommand.execute(
      testConfig(),
      testFlags({
        agent: ['claude-code'],
        apiKey: 'sk-test-secret',
        region: 'cn',
        _positional: ['codex'],
      }),
    )).rejects.toThrow('Unexpected positional argument.');
  });

  it('accepts a supported model as the default', async () => {
    const output = await captureConsoleLog(() => setupCommand.execute(
      testConfig(),
      testFlags({
        agent: ['codex'],
        apiKey: 'sk-test-secret',
        region: 'cn',
        model: 'MiniMax-M3',
      }),
    ));
    expect(JSON.parse(output).verification.model).toBe('MiniMax-M3');
  });

  it('uses MiniMax-M3.1-Flash-Preview when no model is specified', async () => {
    const output = await captureConsoleLog(() => setupCommand.execute(
      testConfig(),
      testFlags({
        agent: ['codex'],
        apiKey: 'sk-cp-test-secret',
        region: 'cn',
      }),
    ));
    expect(JSON.parse(output).verification.model).toBe('MiniMax-M3.1-Flash-Preview');
  });

  it('uses MiniMax-M3 by default for pay-as-you-go keys', async () => {
    const output = await captureConsoleLog(() => setupCommand.execute(
      testConfig(),
      testFlags({
        agent: ['codex'],
        apiKey: 'sk-api-test-secret',
        region: 'cn',
      }),
    ));
    expect(JSON.parse(output).verification.model).toBe('MiniMax-M3');
  });

  it('keeps an explicit model choice for pay-as-you-go keys', async () => {
    const output = await captureConsoleLog(() => setupCommand.execute(
      testConfig(),
      testFlags({
        agent: ['codex'],
        apiKey: 'sk-api-test-secret',
        region: 'cn',
        model: 'MiniMax-M3.1-Flash-Preview',
      }),
    ));
    expect(JSON.parse(output).verification.model).toBe('MiniMax-M3.1-Flash-Preview');
  });

  it('rejects a legacy model outside this setup contract', async () => {
    await expect(setupCommand.execute(
      testConfig(),
      testFlags({
        agent: ['codex'],
        apiKey: 'sk-test-secret',
        region: 'cn',
        model: 'MiniMax-M2.7',
      }),
    )).rejects.toThrow('Unsupported MiniMax model "MiniMax-M2.7"');
  });

  it('accepts grok-build as an alias', async () => {
    const output = await captureConsoleLog(() => setupCommand.execute(
      testConfig(),
      testFlags({
        agent: ['grok-build'],
        apiKey: 'sk-test-secret',
        region: 'cn',
      }),
    ));
    expect(JSON.parse(output).agents).toEqual(['grok']);
  });

  it('accepts both Oh my Pi names and includes it in --all', async () => {
    for (const selection of [{ agent: ['omp', 'oh-my-pi'] }, { all: true }]) {
      const output = await captureConsoleLog(() => setupCommand.execute(
        testConfig(),
        testFlags({ ...selection, apiKey: 'sk-cp-test-secret', region: 'global' }),
      ));
      const result = JSON.parse(output);
      expect(result.agents.filter((agent: string) => agent === 'oh-my-pi')).toHaveLength(1);
      expect(result.files.filter((file: { agent: string }) => file.agent === 'oh-my-pi')).toHaveLength(2);
      expect(result.verification.model).toBe('MiniMax-M3.1-Flash-Preview');
      expect(output).not.toContain('sk-cp-test-secret');
    }
  });

  it('validates --agent values even when --all is present', async () => {
    await expect(setupCommand.execute(
      testConfig(),
      testFlags({
        all: true,
        agent: ['typo'],
        apiKey: 'sk-test-secret',
        region: 'cn',
      }),
    )).rejects.toThrow('Unsupported agent "typo"');
  });

  it('warns scripts when a selected agent is not detected on PATH', async () => {
    const originalPath = process.env.PATH;
    const originalWrite = process.stderr.write.bind(process.stderr);
    let stderr = '';
    process.env.PATH = home;
    (process.stderr as NodeJS.WriteStream).write = (chunk: unknown) => {
      stderr += String(chunk);
      return true;
    };

    try {
      await captureConsoleLog(() => setupCommand.execute(
        testConfig({ quiet: false }),
        testFlags({
          agent: ['pi'],
          apiKey: 'sk-test-secret',
          region: 'cn',
        }),
      ));
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      (process.stderr as NodeJS.WriteStream).write = originalWrite;
    }

    expect(stderr).toBe(
      'Warning: Not detected on PATH: Pi. '
      + 'mmx can write configuration files for them, but will not download or install them for you.\n',
    );
  });
});
