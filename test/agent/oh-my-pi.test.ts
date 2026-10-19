import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { parse } from 'yaml';

import { applyAgentConfigurations, prepareAgentConfigurations } from '../../src/agent/configurator';
import type { AgentSetupOptions } from '../../src/agent/types';

describe('Oh my Pi configuration', () => {
  let homeDir: string;
  let options: AgentSetupOptions;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'mmx-omp-'));
    options = {
      agents: ['oh-my-pi'], homeDir, env: {}, region: 'global',
      apiKey: 'sk-cp-test-only', model: 'MiniMax-M3.1-Flash',
    };
  });

  afterEach(() => rmSync(homeDir, { recursive: true, force: true }));

  it('writes native YAML for both regions, preserves other models/settings, and is idempotent', () => {
    const dir = join(homeDir, '.omp', 'agent');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'models.yaml'), '# keep models comment\nproviders:\n  custom:\n    apiKey: KEEP\n'
      + '  minimax:\n    headers: {x-keep: yes}\n    models:\n'
      + '      - id: keep-model\n        name: Keep\n'
      + '      - id: MiniMax-M3.1-Flash\n        cost: {input: 1, output: 2, cacheRead: 0, cacheWrite: 0}\n');
    writeFileSync(join(dir, 'config.yaml'), '# keep config comment\ntheme: {dark: titanium}\n'
      + 'modelRoles:\n  smol: custom/keep-model\n  default: old/model\n');
    for (const region of ['global', 'cn'] as const) {
      const selected = { ...options, region };
      const prepared = prepareAgentConfigurations(selected);
      expect(prepared.map(file => file.path)).toEqual([join(dir, 'models.yaml'), join(dir, 'config.yaml')]);
      const applied = applyAgentConfigurations(prepared);
      expect(applied.every(file => file.backup)).toBe(true);
      const providerId = region === 'cn' ? 'minimax-cn' : 'minimax';
      const host = region === 'cn' ? 'cn' : 'io';
      const modelsText = readFileSync(join(dir, 'models.yaml'), 'utf8');
      const models = parse(modelsText);
      const provider = models.providers[providerId];
      expect(provider).toMatchObject({
        api: 'anthropic-messages', auth: 'apiKey', apiKey: options.apiKey,
        baseUrl: `https://api.minimax.${host}/anthropic`,
      });
      expect(provider.models.find((model: { id: string }) => model.id === options.model)).toMatchObject({
        contextWindow: 524288,
        thinking: {
          mode: 'anthropic-adaptive', efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
          defaultLevel: 'max', requiresEffort: true,
        },
      });
      expect(modelsText).toContain('# keep models comment');
      expect(models.providers.custom.apiKey).toBe('KEEP');
      expect(models.providers.minimax.headers['x-keep']).toBe('yes');
      expect(models.providers.minimax.models[0].id).toBe('keep-model');
      expect(models.providers.minimax.models[1].cost.input).toBe(1);
      const configText = readFileSync(join(dir, 'config.yaml'), 'utf8');
      expect(configText).toContain('# keep config comment');
      expect(parse(configText)).toMatchObject({
        theme: { dark: 'titanium' },
        modelRoles: { smol: 'custom/keep-model', default: `${providerId}/${options.model}:max` },
      });
      expect(applyAgentConfigurations(prepareAgentConfigurations(selected)).every(file => file.status === 'unchanged'))
        .toBe(true);
    }
    expect(existsSync(join(homeDir, '.pi', 'agent'))).toBe(false);
  });

  it('matches profile and directory precedence without writing during preview', () => {
    const scenarios = [
      [{}, join(homeDir, '.omp', 'agent')],
      [{ PI_CODING_AGENT_DIR: 'relative-omp' }, resolve('relative-omp')],
      [{ PI_CONFIG_DIR: '.custom-omp' }, join(homeDir, '.custom-omp', 'agent')],
      [{ OMP_PROFILE: 'work', PI_CODING_AGENT_DIR: '/ignored' }, join(homeDir, '.omp', 'profiles', 'work', 'agent')],
      [{ PI_PROFILE: 'legacy' }, join(homeDir, '.omp', 'profiles', 'legacy', 'agent')],
      [{ OMP_PROFILE: '', PI_PROFILE: 'legacy' }, join(homeDir, '.omp', 'agent')],
      [{ OMP_PROFILE: 'default' }, join(homeDir, '.omp', 'agent')],
      [{ OMP_PROFILE: '', PI_PROFILE: 'work', PI_CODING_AGENT_DIR: join(homeDir, '.omp', 'profiles', 'work', 'agent') }, join(homeDir, '.omp', 'agent')],
      [{ OMP_PROFILE: 'default', PI_PROFILE: 'work', PI_CODING_AGENT_DIR: join(homeDir, '.omp', 'profiles', 'work', 'agent') }, join(homeDir, '.omp', 'agent')],
      [{ OMP_PROFILE: '', PI_PROFILE: 'work', PI_CODING_AGENT_DIR: join(homeDir, 'custom-agent') }, join(homeDir, 'custom-agent')],
    ] as const;
    for (const [env, dir] of scenarios) {
      const files = prepareAgentConfigurations({ ...options, env });
      expect(files.map(file => file.path)).toEqual([join(dir, 'models.yml'), join(dir, 'config.yml')]);
      expect(applyAgentConfigurations(files, true).every(file => file.status === 'would-configure')).toBe(true);
    }
    expect(existsSync(join(homeDir, '.omp'))).toBe(false);
  });

  it('honors canonical yml precedence and an explicit M3 choice', () => {
    const dir = join(homeDir, '.omp', 'agent');
    mkdirSync(dir, { recursive: true });
    for (const name of ['models', 'config']) {
      writeFileSync(join(dir, `${name}.yml`), '# empty YAML is valid\n');
      writeFileSync(join(dir, `${name}.yaml`), 'ignored: true\n');
    }
    const prepared = prepareAgentConfigurations({ ...options, model: 'MiniMax-M3' });
    applyAgentConfigurations(prepared);
    expect(parse(readFileSync(join(dir, 'config.yml'), 'utf8')).modelRoles.default).toBe('minimax/MiniMax-M3');
    expect(readFileSync(join(dir, 'config.yaml'), 'utf8')).toBe('ignored: true\n');
  });

  it('rejects legacy or malformed configuration before changing any files', () => {
    const dir = join(homeDir, '.omp', 'agent');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'settings.json'), '{"theme":"keep"}');
    expect(() => prepareAgentConfigurations(options)).toThrow('needs migration');
    expect(existsSync(join(dir, 'models.yml'))).toBe(false);
    writeFileSync(join(dir, 'config.yml'), 'modelRoles: []\n');
    expect(() => prepareAgentConfigurations(options)).toThrow('modelRoles must be an object');
    expect(existsSync(join(dir, 'models.yml'))).toBe(false);
    writeFileSync(join(dir, 'config.yml'), '{}\n');
    writeFileSync(join(dir, 'models.yml'), 'providers: {minimax: {models: wrong}}\n');
    expect(() => prepareAgentConfigurations(options)).toThrow('models must be an array');
    writeFileSync(join(dir, 'models.yml'), 'providers: [\n  apiKey: sk-secret-must-not-leak\n');
    expect(() => prepareAgentConfigurations(options)).toThrow('not valid YAML');
    try { prepareAgentConfigurations(options); } catch (error) {
      expect(String(error)).not.toContain('sk-secret-must-not-leak');
    }
  });

  it('rejects invalid profiles before selecting any configuration files', () => {
    for (const OMP_PROFILE of ['../outside', 'trailing.', 'CON', 'con.txt']) {
      expect(() => prepareAgentConfigurations({ ...options, env: { OMP_PROFILE } })).toThrow('profile');
    }
  });
});
