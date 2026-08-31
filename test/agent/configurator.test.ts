import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

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
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      '{\n  "theme": "dark",\n  "modelPicker": {\n'
        + '    "options": [\n'
        + '      { "model": "keep-model", "label": "Keep" },\n'
        + '      { "model": "MiniMax-M2.7", "label": "Old MiniMax" }\n'
        + '    ],\n    "replaceBuiltInOptions": false\n  }\n}\n',
    );
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
        + '{"id":"MiniMax-M3","custom":true,"cost":{"currency":"credits"},'
        + '"compat":{"supportsStrictTools":true}}]}}}\n',
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
    expect(claude.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBeUndefined();
    expect(claude.env.ANTHROPIC_MODEL).toBe('MiniMax-M3[1m]');
    expect(claude.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('MiniMax-M3[1m]');
    expect(claude.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('MiniMax-M2.7');
    expect(claude.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('MiniMax-M2.7-highspeed');
    expect(claude.modelPicker).toEqual({
      options: [
        { model: 'keep-model', label: 'Keep' },
        { model: 'MiniMax-M3[1m]', label: 'MiniMax-M3', description: '1M context' },
        { model: 'MiniMax-M2.7', label: 'MiniMax-M2.7', description: '204.8K context' },
        {
          model: 'MiniMax-M2.7-highspeed',
          label: 'MiniMax-M2.7-highspeed',
          description: '204.8K context · faster inference',
        },
      ],
      replaceBuiltInOptions: false,
    });

    const codex = parseToml(readFileSync(join(home, '.codex', 'config.toml'), 'utf8'));
    expect(codex.model).toBe('MiniMax-M3');
    expect(codex.model_provider).toBe('minimax');
    expect(codex.model_catalog_json).toBe('mmx-model-catalog.json');
    expect(codex.mcp_servers).toEqual({ keep: { command: 'keep' } });
    expect((codex.model_providers as Record<string, Record<string, unknown>>).minimax.base_url)
      .toBe('https://api.minimaxi.com/v1');
    const codexCatalog = JSON.parse(
      readFileSync(join(home, '.codex', 'mmx-model-catalog.json'), 'utf8'),
    );
    expect(codexCatalog._managed_by).toBe('mmx agent setup');
    expect(codexCatalog.models).toHaveLength(3);
    expect(codexCatalog.models[0]).toMatchObject({
      slug: 'MiniMax-M3',
      description: 'MiniMax',
      priority: 0,
      base_instructions: 'You are Codex, a coding agent based on MiniMax-M3. '
        + "You and the user share the same workspace and collaborate to achieve the user's goals.",
      shell_type: 'shell_command',
      supports_parallel_tool_calls: true,
      context_window: 1000000,
      max_context_window: 1000000,
      input_modalities: ['text', 'image'],
      supported_reasoning_levels: [
        { effort: 'none', description: 'Think-Off' },
        { effort: 'high', description: 'Deep' },
      ],
    });
    expect(codexCatalog.models[1]).toMatchObject({
      slug: 'MiniMax-M2.7',
      priority: 1,
      context_window: 204800,
      max_context_window: 204800,
      input_modalities: ['text'],
      supported_reasoning_levels: [{ effort: 'high', description: 'Always on' }],
    });
    expect(codexCatalog.models[2].slug).toBe('MiniMax-M2.7-highspeed');
    expect(codexCatalog.models[2].supported_reasoning_levels)
      .toEqual([{ effort: 'high', description: 'Always on' }]);
    expect(codexCatalog.models[0].apply_patch_tool_type).toBeUndefined();

    const grok = parseToml(readFileSync(join(home, '.grok', 'config.toml'), 'utf8'));
    expect((grok.models as Record<string, unknown>).default).toBe('minimax');
    expect((grok.model as Record<string, Record<string, unknown>>).minimax.api_backend)
      .toBe('chat_completions');
    expect((grok.model as Record<string, Record<string, unknown>>).minimax.max_completion_tokens)
      .toBe(128000);
    expect((grok.model as Record<string, Record<string, unknown>>)['minimax-m2-7'].model)
      .toBe('MiniMax-M2.7');
    expect((grok.model as Record<string, Record<string, unknown>>)['minimax-m2-7-highspeed'].model)
      .toBe('MiniMax-M2.7-highspeed');

    const openCodeText = readFileSync(join(home, '.config', 'opencode', 'opencode.json'), 'utf8');
    const openCode = JSON.parse(openCodeText.replace(/^\s*\/\/.*$/gm, ''));
    expect(openCodeText).toContain('// keep this setting');
    expect(openCode.theme).toBe('system');
    expect(openCode.model).toBe('minimax/MiniMax-M3');
    expect(openCode.provider.minimax.options.baseURL).toBe('https://api.minimaxi.com/v1');
    expect(openCode.provider.minimax.options.headers).toEqual({ 'x-keep': 'yes' });
    expect(openCode.provider.minimax.models['keep-model']).toEqual({ name: 'Keep' });
    expect(openCode.provider.minimax.models['MiniMax-M3'].custom).toBe(true);
    expect(openCode.provider.minimax.models['MiniMax-M3'].attachment).toBe(true);
    expect(openCode.provider.minimax.models['MiniMax-M3'].modalities)
      .toEqual({ input: ['text', 'image'], output: ['text'] });
    expect(openCode.provider.minimax.models['MiniMax-M3'].limit)
      .toEqual({ context: 1000000, output: 128000 });
    expect(openCode.provider.minimax.models['MiniMax-M2.7'].attachment).toBe(false);
    expect(openCode.provider.minimax.models['MiniMax-M2.7'].modalities)
      .toEqual({ input: ['text'], output: ['text'] });
    expect(openCode.provider.minimax.models['MiniMax-M2.7'].limit)
      .toEqual({ context: 204800, output: 131072 });
    expect(openCode.provider.minimax.models['MiniMax-M2.7-highspeed'].limit)
      .toEqual({ context: 204800, output: 131072 });

    const hermes = parseYaml(readFileSync(join(home, '.hermes', 'config.yaml'), 'utf8'));
    expect(hermes.model.provider).toBe('minimax-cn');
    expect(hermes.model.context_length).toBe(1000000);
    expect(hermes.model.max_tokens).toBe(128000);
    expect(hermes.agent.reasoning_overrides['MiniMax-M3']).toBe('none');
    expect(Object.keys(hermes.providers['minimax-cn'].models))
      .toEqual(['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.7-highspeed']);
    expect(readFileSync(join(home, '.hermes', '.env'), 'utf8'))
      .toContain('MINIMAX_CN_API_KEY=sk-test-secret');

    const piModels = JSON.parse(readFileSync(join(home, '.pi', 'agent', 'models.json'), 'utf8'));
    const piSettings = JSON.parse(readFileSync(join(home, '.pi', 'agent', 'settings.json'), 'utf8'));
    expect(piModels.providers['minimax-cn'].headers).toEqual({ 'x-keep': 'yes' });
    expect(piModels.providers['minimax-cn'].models[0].id).toBe('keep-model');
    expect(piModels.providers['minimax-cn'].models[1].custom).toBe(true);
    expect(piModels.providers['minimax-cn'].models[1].cost.currency).toBe('credits');
    expect(piModels.providers['minimax-cn'].models[1]).toMatchObject({
      id: 'MiniMax-M3',
      input: ['text', 'image'],
      contextWindow: 1000000,
      maxTokens: 128000,
    });
    expect(piModels.providers['minimax-cn'].models[1].thinkingLevelMap).toBeUndefined();
    expect(piModels.providers['minimax-cn'].models[1].compat)
      .toEqual({ supportsStrictTools: true, forceAdaptiveThinking: true });
    expect(piModels.providers['minimax-cn'].models[2].thinkingLevelMap).toEqual({ off: null });
    expect(piModels.providers['minimax-cn'].models[3].thinkingLevelMap).toEqual({ off: null });
    expect(piModels.providers['minimax-cn'].api).toBe('anthropic-messages');
    expect(piModels.providers['minimax-cn'].baseUrl).toBe('https://api.minimaxi.com/anthropic');
    expect(piModels.providers['minimax-cn'].models.map((model: { id: string }) => model.id))
      .toEqual(['keep-model', 'MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.7-highspeed']);
    expect(piSettings).toMatchObject({ defaultProvider: 'minimax-cn', defaultModel: 'MiniMax-M3' });

    for (const file of result) {
      expect(statSync(file.path).mode & 0o777).toBe(0o600);
      if (file.backup) {
        expect(existsSync(file.backup)).toBe(true);
        expect(statSync(file.backup).mode & 0o777).toBe(0o600);
      }
    }
  });

  it('accepts the scalar model field from a clean Hermes config', () => {
    mkdirSync(join(home, '.hermes'), { recursive: true });
    writeFileSync(join(home, '.hermes', 'config.yaml'), 'model: ""\nproviders: {}\n');

    applyAgentConfigurations(prepareAgentConfigurations(setupOptions(['hermes'])));

    const configured = parseYaml(readFileSync(join(home, '.hermes', 'config.yaml'), 'utf8'));
    expect(configured.model).toMatchObject({ default: 'MiniMax-M3', provider: 'minimax' });
  });

  it('preserves existing Hermes reasoning overrides', () => {
    mkdirSync(join(home, '.hermes'), { recursive: true });
    writeFileSync(
      join(home, '.hermes', 'config.yaml'),
      'agent:\n  reasoning_effort: high\n  reasoning_overrides:\n'
        + '    keep-model: low\n    MiniMax-M3: none\nproviders: {}\n',
    );

    applyAgentConfigurations(prepareAgentConfigurations(setupOptions(['hermes'])));

    const configured = parseYaml(readFileSync(join(home, '.hermes', 'config.yaml'), 'utf8'));
    expect(configured.agent.reasoning_effort).toBe('high');
    expect(configured.agent.reasoning_overrides)
      .toEqual({ 'keep-model': 'low', 'MiniMax-M3': 'none' });
  });

  it('preserves settings created by the Grok installer', () => {
    mkdirSync(join(home, '.grok'), { recursive: true });
    writeFileSync(
      join(home, '.grok', 'config.toml'),
      '[cli]\ninstaller = "internal"\nchannel = "stable"\n',
    );

    applyAgentConfigurations(prepareAgentConfigurations(setupOptions(['grok'])));

    const configured = parseToml(readFileSync(join(home, '.grok', 'config.toml'), 'utf8'));
    expect(configured.cli).toEqual({ installer: 'internal', channel: 'stable' });
    expect((configured.models as Record<string, unknown>).default).toBe('minimax');
  });

  it('accepts the UTF-8 BOM written by the Windows Grok installer', () => {
    mkdirSync(join(home, '.grok'), { recursive: true });
    writeFileSync(
      join(home, '.grok', 'config.toml'),
      '\ufeff[cli]\ninstaller = "internal"\nchannel = "stable"\n',
    );

    applyAgentConfigurations(prepareAgentConfigurations(setupOptions(['grok'])));

    const source = readFileSync(join(home, '.grok', 'config.toml'), 'utf8');
    expect(source.startsWith('\ufeff')).toBe(false);
    const configured = parseToml(source);
    expect(configured.cli).toEqual({ installer: 'internal', channel: 'stable' });
    expect((configured.models as Record<string, unknown>).default).toBe('minimax');
  });

  it('is idempotent and does not create another backup for unchanged files', () => {
    const options = setupOptions([...AGENT_IDS]);
    applyAgentConfigurations(prepareAgentConfigurations(options));
    const second = applyAgentConfigurations(prepareAgentConfigurations(options));

    expect(second.every((file) => file.status === 'unchanged')).toBe(true);
    expect(second.every((file) => file.backup === undefined)).toBe(true);
  });

  it('adds every MiniMax model to a clean Pi catalog', () => {
    const modelsPath = join(home, '.pi', 'agent', 'models.json');
    writeFileSync(modelsPath, '{}\n');

    applyAgentConfigurations(prepareAgentConfigurations(setupOptions(['pi'])));

    const configured = JSON.parse(readFileSync(modelsPath, 'utf8'));
    expect(configured.providers.minimax.models.map((model: { id: string }) => model.id))
      .toEqual(['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.7-highspeed']);
    expect(configured.providers.minimax.models[0]).toMatchObject({
      input: ['text', 'image'],
      contextWindow: 1000000,
      maxTokens: 128000,
    });
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
    const claudePath = join(home, '.claude', 'settings.json');
    const claudeBefore = readFileSync(claudePath, 'utf8');
    writeFileSync(join(home, '.codex', 'config.toml'), `api_key = "${fakeSecret}" trailing`);
    try {
      prepareAgentConfigurations(setupOptions(['claude-code', 'codex']));
      throw new Error('Expected malformed TOML to be rejected');
    } catch (error) {
      expect((error as Error).message).toContain('not valid TOML');
      expect((error as Error).message).not.toContain(fakeSecret);
    }

    expect(readFileSync(claudePath, 'utf8')).toBe(claudeBefore);
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

  it('does not replace a user-managed Codex model catalog', () => {
    const configPath = join(home, '.codex', 'config.toml');
    const catalogPath = join(home, '.codex', 'my-models.json');
    const config = 'model_catalog_json = "my-models.json"\n';
    const catalog = '{"models":[{"slug":"keep"}]}\n';
    writeFileSync(configPath, config);
    writeFileSync(catalogPath, catalog);

    expect(() => prepareAgentConfigurations(setupOptions(['codex'])))
      .toThrow('already uses a user-managed model catalog');
    expect(readFileSync(configPath, 'utf8')).toBe(config);
    expect(readFileSync(catalogPath, 'utf8')).toBe(catalog);
    expect(existsSync(join(home, '.codex', 'mmx-model-catalog.json'))).toBe(false);
  });

  it('does not claim an existing unmarked mmx Codex catalog', () => {
    const configPath = join(home, '.codex', 'config.toml');
    const catalogPath = join(home, '.codex', 'mmx-model-catalog.json');
    const catalog = '{"models":[{"slug":"keep"}]}\n';
    writeFileSync(catalogPath, catalog);

    expect(() => prepareAgentConfigurations(setupOptions(['codex'])))
      .toThrow('is not managed by mmx');
    expect(readFileSync(configPath, 'utf8')).toBe('[mcp_servers.keep]\ncommand = "keep"\n');
    expect(readFileSync(catalogPath, 'utf8')).toBe(catalog);
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

  it('rejects duplicate targets before creating files or backups', () => {
    const shared = join(home, 'shared-agent-config');
    expect(() => prepareAgentConfigurations(setupOptions(
      ['claude-code', 'pi'],
      { env: { CLAUDE_CONFIG_DIR: shared, PI_CODING_AGENT_DIR: shared } },
    ))).toThrow('Multiple agent configuration paths');
    expect(existsSync(shared)).toBe(false);
  });

  it('removes the setup lock when installation receives an exit signal', async () => {
    if (process.platform === 'win32') return;
    const configuratorUrl = pathToFileURL(
      join(import.meta.dir, '../../src/agent/configurator.ts'),
    ).href;
    const installerUrl = pathToFileURL(join(import.meta.dir, '../../src/agent/installer.ts')).href;
    for (const [signal, expectedExitCode] of [
      ['SIGHUP', 129],
      ['SIGINT', 130],
      ['SIGTERM', 143],
    ] as const) {
      const lockDirectory = mkdtempSync(join(tmpdir(), `mmx-agent-lock-${signal.toLowerCase()}-`));
      const readyPath = join(lockDirectory, 'installer.ready');
      const npm = join(lockDirectory, 'npm');
      writeFileSync(npm, '#!/bin/sh\nprintf ready > "$MMX_INSTALL_READY"\nsleep 30\n');
      chmodSync(npm, 0o755);
      const child = Bun.spawn({
        cmd: [
          process.execPath,
          '-e',
          `import { withAgentSetupLock } from ${JSON.stringify(configuratorUrl)};`
            + `import { installAgent } from ${JSON.stringify(installerUrl)};`
            + 'await withAgentSetupLock(() => installAgent('
            + "'codex', { commandExists: () => true }));",
        ],
        env: {
          ...process.env,
          TMPDIR: lockDirectory,
          PATH: `${lockDirectory}:${process.env.PATH ?? ''}`,
          MMX_INSTALL_READY: readyPath,
        },
        stdout: 'ignore',
        stderr: 'ignore',
      });
      try {
        for (let attempt = 0; attempt < 100 && !existsSync(readyPath); attempt += 1) {
          await Bun.sleep(10);
        }
        expect(existsSync(readyPath)).toBe(true);
        expect(readdirSync(lockDirectory).filter(name => name.startsWith('mmx-agent-setup-')))
          .toHaveLength(1);
        child.kill(signal);
        expect(await child.exited).toBe(expectedExitCode);
        expect(readdirSync(lockDirectory).filter(name => name.startsWith('mmx-agent-setup-')))
          .toHaveLength(0);
      } finally {
        child.kill();
        await child.exited;
        rmSync(lockDirectory, { recursive: true, force: true });
      }
    }
  });

  it('preserves comments on unrelated Claude model picker entries', () => {
    const settingsPath = join(home, '.claude', 'settings.json');
    writeFileSync(
      settingsPath,
      '{\n  "modelPicker": {\n    "options": [\n'
        + '      // keep this custom model\n'
        + '      { "model": "keep-model", "label": "Keep" },\n'
        + '      { "model": "MiniMax-M2.7", "label": "Replace" }\n'
        + '    ]\n  }\n}\n',
    );

    applyAgentConfigurations(prepareAgentConfigurations(setupOptions(['claude-code'])));

    const updated = readFileSync(settingsPath, 'utf8');
    expect(updated).toContain('// keep this custom model');
    expect(updated).toContain('"model": "keep-model"');
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
