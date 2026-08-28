import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import setupCommand from '../../../src/commands/agent/setup';
import { registry } from '../../../src/registry';
import type { Config } from '../../../src/config/schema';
import type { GlobalFlags } from '../../../src/types/flags';

function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    region: 'cn',
    baseUrl: 'https://api.minimaxi.com',
    output: 'json',
    timeout: 30,
    verbose: false,
    quiet: false,
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

describe('agent setup command', () => {
  let home: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    home = join(tmpdir(), `mmx-agent-command-${process.pid}-${Date.now()}`);
    mkdirSync(home, { recursive: true });
    originalHome = process.env.HOME;
    process.env.HOME = home;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('is registered under agent setup', () => {
    expect(registry.resolve(['agent', 'setup']).command).toBe(setupCommand);
  });

  it('supports scriptable dry-run output without exposing the key', async () => {
    let output = '';
    const originalLog = console.log;
    console.log = (message: string) => { output += message; };
    try {
      await setupCommand.execute(
        testConfig(),
        testFlags({
          agent: ['codex'],
          apiKey: 'sk-test-secret',
          region: 'cn',
          output: 'json',
        }),
      );
    } finally {
      console.log = originalLog;
    }

    const parsed = JSON.parse(output);
    expect(parsed.agents).toEqual(['codex']);
    expect(parsed.files[0].status).toBe('would-configure');
    expect(output).not.toContain('sk-test-secret');
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
        skipVerify: false,
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
    )).rejects.toThrow('Unexpected positional argument: codex');
  });

  it('rejects models whose limits are outside this setup contract', async () => {
    await expect(setupCommand.execute(
      testConfig(),
      testFlags({
        agent: ['codex'],
        apiKey: 'sk-test-secret',
        region: 'cn',
        model: 'MiniMax-M2.7',
      }),
    )).rejects.toThrow('supports only --model MiniMax-M3');
  });

  it('accepts grok-build as an alias', async () => {
    let output = '';
    const originalLog = console.log;
    console.log = (message: string) => { output += message; };
    try {
      await setupCommand.execute(
        testConfig(),
        testFlags({
          agent: ['grok-build'],
          apiKey: 'sk-test-secret',
          region: 'cn',
        }),
      );
    } finally {
      console.log = originalLog;
    }
    expect(JSON.parse(output).agents).toEqual(['grok']);
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

});
