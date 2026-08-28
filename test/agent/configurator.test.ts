import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';

import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';

import {
  applyAgentConfigurations,
  prepareAgentConfigurations,
} from '../../src/agent/configurator';
import { AGENT_IDS, type AgentId, type AgentSetupOptions } from '../../src/agent/types';

describe('agent configurator', () => {
  let home: string;

  function setupOptions(
    agents: AgentId[],
    overrides: Partial<AgentSetupOptions> = {},
  ): AgentSetupOptions {
    return {
      agents,
      apiKey: 'sk-test-secret',
      region: 'global',
      model: 'MiniMax-M3',
      homeDir: home,
      env: {},
      ...overrides,
    };
  }

  beforeEach(() => {
    home = join(tmpdir(), `mmx-agent-config-${process.pid}-${Date.now()}`);
    mkdirSync(join(home, '.claude'), { recursive: true });
    mkdirSync(join(home, '.codex'), { recursive: true });
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), '{\n  "theme": "dark"\n}\n');
    writeFileSync(join(home, '.codex', 'config.toml'), '[mcp_servers.keep]\ncommand = "keep"\n');
    writeFileSync(
      join(home, '.config', 'opencode', 'opencode.json'),
      '{\n  // keep this setting\n  "theme": "system",\n  "provider": {\n    "minimax": {\n      "extra": true,\n      "options": { "headers": { "x-keep": "yes" } },\n      "models": {\n        "keep-model": { "name": "Keep" },\n        "MiniMax-M3": { "custom": true }\n      }\n    }\n  }\n}\n',
    );
    mkdirSync(join(home, '.pi', 'agent'), { recursive: true });
    writeFileSync(
      join(home, '.pi', 'agent', 'models.json'),
      '{"providers":{"minimax-cn":{"headers":{"x-keep":"yes"},"models":['
        + '{"id":"keep-model","name":"Keep"},'
        + '{"id":"MiniMax-M3","custom":true,"cost":{"currency":"credits"}}]}}}\n',
    );
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('configures all supported agents without discarding unrelated settings', () => {
    const prepared = prepareAgentConfigurations(setupOptions([...AGENT_IDS], { region: 'cn' }));
    const result = applyAgentConfigurations(prepared);

    expect(result.every((file) => file.status === 'configured')).toBe(true);

    const claude = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
    expect(claude.theme).toBe('dark');
    expect(claude.env.ANTHROPIC_BASE_URL).toBe('https://api.minimaxi.com/anthropic');
    expect(claude.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-test-secret');
    expect(claude.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('1000000');
    expect(claude.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe('512000');
    expect(claude.env.ANTHROPIC_MODEL).toBe('MiniMax-M3[1m]');

    const codex = parseToml(readFileSync(join(home, '.codex', 'config.toml'), 'utf8'));
    expect(codex.model).toBe('MiniMax-M3');
    expect(codex.model_provider).toBe('minimax');
    expect(codex.mcp_servers).toEqual({ keep: { command: 'keep' } });
    expect((codex.model_providers as Record<string, Record<string, unknown>>).minimax.base_url)
      .toBe('https://api.minimaxi.com/v1');

    const grok = parseToml(readFileSync(join(home, '.grok', 'config.toml'), 'utf8'));
    expect((grok.models as Record<string, unknown>).default).toBe('minimax');
    expect((grok.model as Record<string, Record<string, unknown>>).minimax.api_backend)
      .toBe('chat_completions');
    expect((grok.model as Record<string, Record<string, unknown>>).minimax.max_completion_tokens)
      .toBe(512000);

    const openCodeText = readFileSync(join(home, '.config', 'opencode', 'opencode.json'), 'utf8');
    const openCode = JSON.parse(openCodeText.replace(/^\s*\/\/.*$/gm, ''));
    expect(openCodeText).toContain('// keep this setting');
    expect(openCode.theme).toBe('system');
    expect(openCode.model).toBe('minimax/MiniMax-M3');
    expect(openCode.provider.minimax.options.baseURL).toBe('https://api.minimaxi.com/v1');
    expect(openCode.provider.minimax.options.headers).toEqual({ 'x-keep': 'yes' });
    expect(openCode.provider.minimax.models['keep-model']).toEqual({ name: 'Keep' });
    expect(openCode.provider.minimax.models['MiniMax-M3'].custom).toBe(true);
    expect(openCode.provider.minimax.models['MiniMax-M3'].limit)
      .toEqual({ context: 1000000, output: 512000 });

    const hermes = parseYaml(readFileSync(join(home, '.hermes', 'config.yaml'), 'utf8'));
    expect(hermes.model.provider).toBe('minimax-cn');
    expect(hermes.model.context_length).toBe(1000000);
    expect(hermes.model.max_tokens).toBe(512000);
    expect(readFileSync(join(home, '.hermes', '.env'), 'utf8'))
      .toContain('MINIMAX_CN_API_KEY=sk-test-secret');

    const piModels = JSON.parse(readFileSync(join(home, '.pi', 'agent', 'models.json'), 'utf8'));
    const piSettings = JSON.parse(readFileSync(join(home, '.pi', 'agent', 'settings.json'), 'utf8'));
    expect(piModels.providers['minimax-cn'].headers).toEqual({ 'x-keep': 'yes' });
    expect(piModels.providers['minimax-cn'].models[0].id).toBe('keep-model');
    expect(piModels.providers['minimax-cn'].models[1].custom).toBe(true);
    expect(piModels.providers['minimax-cn'].models[1].cost.currency).toBe('credits');
    expect(piModels.providers['minimax-cn'].models[1].contextWindow).toBe(1000000);
    expect(piModels.providers['minimax-cn'].models[1].maxTokens).toBe(512000);
    expect(piSettings).toMatchObject({ defaultProvider: 'minimax-cn', defaultModel: 'MiniMax-M3' });

    for (const file of result) {
      expect(statSync(file.path).mode & 0o777).toBe(0o600);
      if (file.backup) expect(existsSync(file.backup)).toBe(true);
    }
  });

  it('is idempotent and does not create another backup for unchanged files', () => {
    const options = setupOptions([...AGENT_IDS]);
    applyAgentConfigurations(prepareAgentConfigurations(options));
    const second = applyAgentConfigurations(prepareAgentConfigurations(options));

    expect(second.every((file) => file.status === 'unchanged')).toBe(true);
    expect(second.every((file) => file.backup === undefined)).toBe(true);
  });

  it('does not write files in dry-run mode', () => {
    const prepared = prepareAgentConfigurations(setupOptions(['grok']));
    const result = applyAgentConfigurations(prepared, true);

    expect(result[0]?.status).toBe('would-configure');
    expect(existsSync(join(home, '.grok', 'config.toml'))).toBe(false);
  });

  it('honors GROK_HOME when resolving the Grok config path', () => {
    const prepared = prepareAgentConfigurations(setupOptions(
      ['grok'],
      { env: { GROK_HOME: 'custom-grok' } },
    ));
    expect(prepared.map((file) => file.path))
      .toEqual([join(home, 'custom-grok', 'config.toml')]);
  });

  it('uses the active OpenCode config file', () => {
    const custom = join(home, 'custom-opencode.jsonc');
    expect(prepareAgentConfigurations(setupOptions(
      ['opencode'],
      { env: { OPENCODE_CONFIG: custom } },
    )).map((file) => file.path)).toEqual([custom]);

    const json = join(home, '.config', 'opencode', 'opencode.json');
    const jsonc = join(home, '.config', 'opencode', 'opencode.jsonc');
    rmSync(json);
    writeFileSync(jsonc, '{ // jsonc\n}\n');
    expect(prepareAgentConfigurations(setupOptions(['opencode']))
      .map((file) => file.path)).toEqual([jsonc]);

    writeFileSync(json, '{}\n');
    expect(() => prepareAgentConfigurations(setupOptions(['opencode'])))
      .toThrow('Both OpenCode global config files exist');
  });

  it('does not use env.HOME as a cross-platform home override', () => {
    const prepared = prepareAgentConfigurations(setupOptions(
      ['claude-code'],
      { homeDir: undefined, env: { HOME: '/unexpected-home' } },
    ));
    expect(prepared.map((file) => file.path))
      .toEqual([join(homedir(), '.claude', 'settings.json')]);
  });

  it('rejects malformed existing configuration before any write', () => {
    const fakeSecret = 'sk-FAKE-SECRET-IN-MALFORMED-TOML';
    writeFileSync(join(home, '.codex', 'config.toml'), `api_key = "${fakeSecret}" trailing`);
    try {
      prepareAgentConfigurations(setupOptions(['claude-code', 'codex']));
      throw new Error('Expected malformed TOML to be rejected');
    } catch (error) {
      expect((error as Error).message).toContain('not valid TOML');
      expect((error as Error).message).not.toContain(fakeSecret);
    }

    const claude = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
    expect(claude).toEqual({ theme: 'dark' });
  });

  it('does not treat a following TOML array table as part of the target section', () => {
    writeFileSync(
      join(home, '.codex', 'config.toml'),
      '[model_providers.minimax]\nname = "Old"\n\n[[hooks]]\nbase_url = "keep"\n',
    );
    applyAgentConfigurations(prepareAgentConfigurations(setupOptions(['codex'])));

    const config = parseToml(readFileSync(join(home, '.codex', 'config.toml'), 'utf8'));
    expect((config.hooks as Array<Record<string, unknown>>)[0]?.base_url).toBe('keep');
    expect((config.model_providers as Record<string, Record<string, unknown>>).minimax.base_url)
      .toBe('https://api.minimax.io/v1');
  });

  it('preserves inline comments on managed TOML assignments', () => {
    const path = join(home, '.codex', 'config.toml');
    writeFileSync(
      path,
      'model = "old" # keep root reason\n\n[model_providers.minimax]\nname = "Old" # keep provider reason\n',
    );

    applyAgentConfigurations(prepareAgentConfigurations(setupOptions(['codex'])));

    const config = readFileSync(path, 'utf8');
    expect(config).toContain('model = "MiniMax-M3" # keep root reason');
    expect(config).toContain('name = "MiniMax" # keep provider reason');
  });

  it('rejects TOML multiline strings instead of editing their contents', () => {
    const path = join(home, '.codex', 'config.toml');
    const source = 'notes = """\nmodel = keep\n"""\n';
    writeFileSync(path, source);

    expect(() => prepareAgentConfigurations(setupOptions(['codex'])))
      .toThrow('contains a multiline string');
    expect(readFileSync(path, 'utf8')).toBe(source);
  });

  it('deduplicates the Hermes API key in dotenv files', () => {
    mkdirSync(join(home, '.hermes'), { recursive: true });
    writeFileSync(
      join(home, '.hermes', '.env'),
      'export MINIMAX_API_KEY=old-one\nKEEP=yes\nMINIMAX_API_KEY=old-two\n',
    );
    applyAgentConfigurations(prepareAgentConfigurations(setupOptions(['hermes'])));

    const dotenv = readFileSync(join(home, '.hermes', '.env'), 'utf8');
    expect(dotenv.match(/^MINIMAX_API_KEY=/gm)?.length).toBe(1);
    expect(dotenv).toContain('MINIMAX_API_KEY=sk-test-secret');
    expect(dotenv).toContain('KEEP=yes');
  });

  it('tightens permissions even when file contents are unchanged', () => {
    const options = setupOptions(['claude-code']);
    applyAgentConfigurations(prepareAgentConfigurations(options));
    const path = join(home, '.claude', 'settings.json');
    chmodSync(path, 0o644);

    const result = applyAgentConfigurations(prepareAgentConfigurations(options));

    expect(result[0]?.status).toBe('configured');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('updates a symbolic-link target without replacing the link', () => {
    const link = join(home, '.codex', 'config.toml');
    const target = join(home, 'dotfiles', 'codex.toml');
    mkdirSync(join(home, 'dotfiles'), { recursive: true });
    rmSync(link);
    writeFileSync(target, '[mcp_servers.keep]\ncommand = "keep"\n');
    symlinkSync(target, link);

    applyAgentConfigurations(prepareAgentConfigurations(setupOptions(['codex'], { region: 'cn' })));

    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, 'utf8')).toContain('https://api.minimaxi.com/v1');
  });

  it('rejects a symbolic link whose target changed after preparation', () => {
    const link = join(home, '.codex', 'config.toml');
    const first = join(home, 'dotfiles', 'first.toml');
    const second = join(home, 'dotfiles', 'second.toml');
    const source = '[mcp_servers.keep]\ncommand = "keep"\n';
    mkdirSync(join(home, 'dotfiles'), { recursive: true });
    rmSync(link);
    writeFileSync(first, source);
    writeFileSync(second, source);
    symlinkSync(first, link);
    const prepared = prepareAgentConfigurations(setupOptions(['codex']));
    rmSync(link);
    symlinkSync(second, link);

    expect(() => applyAgentConfigurations(prepared)).toThrow('Configuration changed');
    expect(readFileSync(first, 'utf8')).toBe(source);
    expect(readFileSync(second, 'utf8')).toBe(source);
  });

  it('rejects a parent-directory link whose target changed after preparation', () => {
    const link = join(home, '.codex');
    const first = join(home, 'dotfiles-one');
    const second = join(home, 'dotfiles-two');
    const source = '[mcp_servers.keep]\ncommand = "keep"\n';
    rmSync(link, { recursive: true });
    for (const directory of [first, second]) {
      mkdirSync(directory);
      writeFileSync(join(directory, 'config.toml'), source);
    }
    symlinkSync(first, link, 'dir');
    const prepared = prepareAgentConfigurations(setupOptions(['codex']));
    rmSync(link);
    symlinkSync(second, link, 'dir');

    expect(() => applyAgentConfigurations(prepared)).toThrow('Configuration changed');
    expect(readFileSync(join(first, 'config.toml'), 'utf8')).toBe(source);
    expect(readFileSync(join(second, 'config.toml'), 'utf8')).toBe(source);
  });
});
