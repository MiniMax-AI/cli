import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parse } from 'jsonc-parser/lib/esm/main.js';

import { applyAgentConfigurations, prepareAgentConfigurations } from '../../src/agent/configurator';
import type { AgentSetupOptions } from '../../src/agent/types';

describe('Zed configuration', () => {
  let homeDir: string;
  let options: AgentSetupOptions;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'mmx-zed-'));
    options = {
      agents: ['zed'], homeDir, env: {}, region: 'global',
      apiKey: 'sk-cp-test-only', model: 'MiniMax-M3.1-Flash',
    };
  });

  afterEach(() => rmSync(homeDir, { recursive: true, force: true }));

  it('merges JSONC settings for both regions, preserves user settings, and is idempotent', () => {
    const dir = join(homeDir, '.config', 'zed');
    const path = join(dir, 'settings.json');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, '// keep comment\n{\n  "theme": "One Dark",\n  "language_models": {\n'
      + '    "openai_compatible": {\n      "other": { "api_url": "https://x", "available_models": [] },\n'
      + '      "minimax": { "available_models": [{ "name": "keep-model", "max_tokens": 1 },'
      + ' { "name": "MiniMax-M3", "max_tokens": 2 }] },\n    },\n  },\n'
      + '  "agent": { "default_model": { "provider": "zed.dev", "model": "x" }, "dock": "left" },\n}\n');
    for (const region of ['global', 'cn'] as const) {
      const prepared = prepareAgentConfigurations({ ...options, region });
      expect(prepared.map(file => file.path)).toEqual([path]);
      expect(applyAgentConfigurations(prepared)[0]?.backup).toBeDefined();
      const text = readFileSync(path, 'utf8');
      const settings = parse(text);
      expect(text).toContain('// keep comment');
      expect(settings.theme).toBe('One Dark');
      expect(settings.agent.dock).toBe('left');
      expect(settings.language_models.openai_compatible.other.api_url).toBe('https://x');
      const provider = settings.language_models.openai_compatible.minimax;
      expect(provider.api_url).toBe(`https://api.minimax.${region === 'cn' ? 'cn' : 'io'}/v1`);
      expect(JSON.stringify(settings)).not.toContain(options.apiKey);
      const models = provider.available_models;
      expect(models.map((model: { name: string }) => model.name))
        .toEqual(['keep-model', 'MiniMax-M3', 'MiniMax-M3.1-Flash']);
      expect(models[2]).toMatchObject({
        max_tokens: 524288, max_output_tokens: 128000, reasoning_effort: 'max',
        capabilities: { tools: true, images: true, interleaved_reasoning: true, chat_completions: true },
      });
      expect(models[1]).toMatchObject({ max_tokens: 1_000_000, reasoning_effort: 'high' });
      for (const model of models) expect(model.reasoning_effort).not.toBe('none');
      expect(settings.agent.default_model).toEqual({
        provider: 'minimax', model: 'MiniMax-M3.1-Flash', enable_thinking: true, effort: 'max',
      });
    }
    const again = prepareAgentConfigurations({ ...options, region: 'cn' });
    expect(again[0]?.before).toBe(again[0]?.after);
  });

  it('writes a fresh config with the selected model and honors XDG_CONFIG_HOME', () => {
    const xdg = join(homeDir, 'xdg');
    const [file] = prepareAgentConfigurations({
      ...options, model: 'MiniMax-M3', env: { XDG_CONFIG_HOME: xdg },
    });
    expect(file?.path).toBe(join(xdg, 'zed', 'settings.json'));
    const settings = parse(file!.after);
    expect(settings.agent.default_model).toMatchObject({ model: 'MiniMax-M3', effort: 'high' });
    expect(settings.language_models.openai_compatible.minimax.available_models).toHaveLength(2);
  });

  it('uses the 1M Flash window when selected', () => {
    const [file] = prepareAgentConfigurations({ ...options, m31ContextWindow: 1_000_000 });
    const models = parse(file!.after).language_models.openai_compatible.minimax.available_models;
    expect(models[0]).toMatchObject({ name: 'MiniMax-M3.1-Flash', max_tokens: 1_000_000 });
  });

  it('rejects a non-array available_models without changing files', () => {
    const dir = join(homeDir, '.config', 'zed');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'settings.json'),
      '{ "language_models": { "openai_compatible": { "minimax": { "available_models": {} } } } }');
    expect(() => prepareAgentConfigurations(options)).toThrow('available_models must be an array');
  });
});
