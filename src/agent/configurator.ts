import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { homedir, tmpdir } from 'os';
import { basename, dirname, isAbsolute, join, resolve } from 'path';

import {
  applyEdits,
  modify,
  parse,
  type ParseError,
} from 'jsonc-parser/lib/esm/main.js';
import { parse as parseToml } from 'smol-toml';
import { parseDocument } from 'yaml';

import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import type {
  AgentId,
  AgentSetupOptions,
  AppliedAgentFile,
  PreparedAgentFile,
} from './types';

const JSON_FORMATTING = { insertSpaces: true, tabSize: 2, eol: '\n' };
const TOML_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
const INVALID_CONFIG_HINT = 'Fix the existing configuration file and retry. No files were changed.';

export function endpointsForRegion(region: AgentSetupOptions['region']) {
  const host = region === 'cn' ? 'https://api.minimaxi.com' : 'https://api.minimax.io';
  return {
    anthropic: `${host}/anthropic`,
    openai: `${host}/v1`,
  };
}

function pathFromOverride(value: string | undefined, fallback: string, home: string): string {
  if (!value?.trim()) return fallback;
  return isAbsolute(value) ? value : resolve(home, value);
}

function configPathsForAgent(
  agent: AgentId,
  options: AgentSetupOptions,
): string[] {
  const home = options.homeDir ?? homedir();
  const env = options.env ?? process.env;

  switch (agent) {
    case 'claude-code': {
      const dir = pathFromOverride(env.CLAUDE_CONFIG_DIR, join(home, '.claude'), home);
      return [join(dir, 'settings.json')];
    }
    case 'codex': {
      const dir = pathFromOverride(env.CODEX_HOME, join(home, '.codex'), home);
      return [join(dir, 'config.toml')];
    }
    case 'grok':
      return [join(pathFromOverride(env.GROK_HOME, join(home, '.grok'), home), 'config.toml')];
    case 'opencode': {
      if (env.OPENCODE_CONFIG?.trim()) {
        const customPath = env.OPENCODE_CONFIG.trim();
        return [isAbsolute(customPath) ? customPath : resolve(customPath)];
      }
      const xdgConfig = pathFromOverride(env.XDG_CONFIG_HOME, join(home, '.config'), home);
      const configDir = join(xdgConfig, 'opencode');
      const jsonPath = join(configDir, 'opencode.json');
      const jsoncPath = join(configDir, 'opencode.jsonc');
      if (existsSync(jsonPath) && existsSync(jsoncPath)) {
        throw new CLIError(
          `Both OpenCode global config files exist: ${jsonPath} and ${jsoncPath}.`,
          ExitCode.GENERAL,
          'Keep one global config file, or set OPENCODE_CONFIG to the file mmx should update.',
        );
      }
      return [existsSync(jsoncPath) ? jsoncPath : jsonPath];
    }
    case 'hermes': {
      const defaultDir = join(home, '.hermes');
      const dir = pathFromOverride(env.HERMES_HOME, defaultDir, home);
      return [join(dir, 'config.yaml'), join(dir, '.env')];
    }
    case 'pi': {
      const dir = pathFromOverride(
        env.PI_CODING_AGENT_DIR,
        join(home, '.pi', 'agent'),
        home,
      );
      return [join(dir, 'models.json'), join(dir, 'settings.json')];
    }
  }
}

function readExisting(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function readPrepared(path: string): { targetPath: string; before: string | null } {
  const targetPath = writeTarget(path);
  return { targetPath, before: readExisting(targetPath) };
}

function assertObjectRoot(value: unknown, label: string): asserts value is Record<string, unknown> {
  assertObject(value, `${label} must contain a JSON object at its root.`);
}

function assertObject(
  value: unknown,
  message: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CLIError(
      message,
      ExitCode.GENERAL,
      INVALID_CONFIG_HINT,
    );
  }
}

function parseJsoncObject(source: string, label: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const root = parse(source, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  if (errors.length > 0) {
    throw new CLIError(
      `${label} is not valid JSON/JSONC.`,
      ExitCode.GENERAL,
      INVALID_CONFIG_HINT,
    );
  }
  assertObjectRoot(root, label);
  return root;
}

function updateJsonc(
  before: string | null,
  label: string,
  updates: Array<{ path: Array<string | number>; value: unknown }>,
): string {
  let source = before ?? '{}\n';
  parseJsoncObject(source, label);

  for (const update of updates) {
    source = applyEdits(source, modify(source, update.path, update.value, {
      formattingOptions: JSON_FORMATTING,
    }));
  }
  return source.endsWith('\n') ? source : `${source}\n`;
}

interface TomlSection {
  bodyStart: number;
  end: number;
}

function findTomlSection(source: string, sectionName: string): TomlSection | undefined {
  const lines = source.match(/.*(?:\r?\n|$)/g)?.filter(Boolean) ?? [];
  let offset = 0;
  let found: TomlSection | undefined;

  for (const line of lines) {
    const table = line.match(/^\s*\[([^\][\r\n]+)]\s*(?:#.*)?(?:\r?\n)?$/);
    const arrayTable = line.match(/^\s*\[\[([^\][\r\n]+)]]\s*(?:#.*)?(?:\r?\n)?$/);
    if (table || arrayTable) {
      if (found) {
        found.end = offset;
        return found;
      }
      if (table?.[1]?.trim() === sectionName) {
        found = {
          bodyStart: offset + line.length,
          end: source.length,
        };
      }
    }
    offset += line.length;
  }
  return found;
}

function tomlCommentSuffix(line: string): string {
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote === '"' && char === '\\') {
      index += 1;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#') {
      let start = index;
      while (start > 0 && /[ \t]/.test(line[start - 1]!)) start -= 1;
      return line.slice(start);
    }
  }
  return '';
}

function replaceTomlAssignments(
  body: string,
  entries: Record<string, string | number | boolean>,
): string {
  let updated = body;
  for (const [key, value] of Object.entries(entries)) {
    if (!TOML_KEY_PATTERN.test(key)) {
      throw new CLIError(`Invalid TOML key: ${key}`, ExitCode.GENERAL);
    }
    const rendered = typeof value === 'string' ? JSON.stringify(value) : String(value);
    const line = `${key} = ${rendered}`;
    const assignment = new RegExp(`^(\\s*)${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=.*$`, 'm');
    if (assignment.test(updated)) {
      updated = updated.replace(
        assignment,
        (match, indent: string) => `${indent}${line}${tomlCommentSuffix(match)}`,
      );
    } else {
      if (updated.length > 0 && !updated.endsWith('\n')) updated += '\n';
      updated += `${line}\n`;
    }
  }
  return updated;
}

function upsertTomlSection(
  source: string,
  sectionName: string,
  entries: Record<string, string | number | boolean>,
): string {
  const section = findTomlSection(source, sectionName);
  if (section) {
    const body = source.slice(section.bodyStart, section.end);
    return source.slice(0, section.bodyStart)
      + replaceTomlAssignments(body, entries)
      + source.slice(section.end);
  }

  let updated = source;
  if (updated.length > 0 && !updated.endsWith('\n')) updated += '\n';
  if (updated.length > 0 && !updated.endsWith('\n\n')) updated += '\n';
  updated += `[${sectionName}]\n${replaceTomlAssignments('', entries)}`;
  return updated;
}

function upsertTomlRoot(
  source: string,
  entries: Record<string, string | number | boolean>,
): string {
  const firstSection = source.search(/^\s*\[/m);
  const rootEnd = firstSection === -1 ? source.length : firstSection;
  const root = replaceTomlAssignments(source.slice(0, rootEnd), entries);
  return root + source.slice(rootEnd);
}

function updateToml(
  before: string | null,
  label: string,
  root: Record<string, string | number | boolean>,
  sections: Array<{ name: string; entries: Record<string, string | number | boolean> }>,
): string {
  let source = before ?? '';
  try {
    parseToml(source);
  } catch {
    throw new CLIError(
      `${label} is not valid TOML.`,
      ExitCode.GENERAL,
      INVALID_CONFIG_HINT,
    );
  }

  if (source.includes('"""') || source.includes("'''")) {
    throw new CLIError(
      `${label} contains a multiline string that mmx cannot safely preserve.`,
      ExitCode.GENERAL,
      'Update this configuration manually. No files were changed.',
    );
  }

  source = upsertTomlRoot(source, root);
  for (const section of sections) {
    source = upsertTomlSection(source, section.name, section.entries);
  }
  if (!source.endsWith('\n')) source += '\n';

  try {
    parseToml(source);
  } catch {
    throw new CLIError(
      `Could not safely merge ${label}.`,
      ExitCode.GENERAL,
      'No files were changed. Convert inline TOML tables to standard table sections and retry.',
    );
  }
  return source;
}

function updateHermesYaml(
  before: string | null,
  provider: 'minimax' | 'minimax-cn',
  model: string,
  baseUrl: string,
): string {
  const document = parseDocument(before ?? '{}\n');
  if (document.errors.length > 0) {
    throw new CLIError(
      `Hermes config.yaml is not valid YAML: ${document.errors[0]?.message ?? 'parse error'}`,
      ExitCode.GENERAL,
      INVALID_CONFIG_HINT,
    );
  }
  const root = document.toJS() as unknown;
  assertObjectRoot(root, 'Hermes config.yaml');
  if (root.model !== undefined) {
    assertObject(
      root.model,
      'Hermes config.yaml model section must be an object.',
    );
  }
  document.setIn(['model', 'default'], model);
  document.setIn(['model', 'provider'], provider);
  document.setIn(['model', 'base_url'], baseUrl);
  document.setIn(['model', 'context_length'], 1000000);
  document.setIn(['model', 'max_tokens'], 512000);
  return document.toString();
}

function dotenvValue(value: string): string {
  return /^[A-Za-z0-9_./:-]+$/.test(value)
    ? value
    : JSON.stringify(value);
}

function updateDotenv(before: string | null, key: string, value: string): string {
  const source = before ?? '';
  const line = `${key}=${dotenvValue(value)}`;
  const pattern = new RegExp(`^(?:export\\s+)?${key}=.*$`, 'gm');
  let found = false;
  let updated = source.replace(pattern, () => {
    if (found) return '';
    found = true;
    return line;
  });
  if (!found) {
    if (updated.length > 0 && !updated.endsWith('\n')) updated += '\n';
    updated += `${line}\n`;
  }
  return updated.endsWith('\n') ? updated : `${updated}\n`;
}

function prepareClaude(options: AgentSetupOptions, path: string): PreparedAgentFile[] {
  const prepared = readPrepared(path);
  const endpoints = endpointsForRegion(options.region);
  const model = options.model === 'MiniMax-M3' ? 'MiniMax-M3[1m]' : options.model;
  const env = {
    ANTHROPIC_BASE_URL: endpoints.anthropic,
    ANTHROPIC_AUTH_TOKEN: options.apiKey,
    API_TIMEOUT_MS: '3000000',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000',
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: '512000',
    ANTHROPIC_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
  };
  return [{
    agent: 'claude-code',
    path,
    ...prepared,
    after: updateJsonc(prepared.before, 'Claude Code settings.json', Object.entries(env).map(
      ([key, value]) => ({ path: ['env', key], value }),
    )),
  }];
}

function prepareCodex(options: AgentSetupOptions, path: string): PreparedAgentFile[] {
  const prepared = readPrepared(path);
  const endpoints = endpointsForRegion(options.region);
  return [{
    agent: 'codex',
    path,
    ...prepared,
    after: updateToml(prepared.before, 'Codex config.toml', {
      model: options.model,
      model_provider: 'minimax',
      model_context_window: 1000000,
    }, [{
      name: 'model_providers.minimax',
      entries: {
        name: 'MiniMax',
        base_url: endpoints.openai,
        experimental_bearer_token: options.apiKey,
        wire_api: 'responses',
      },
    }]),
  }];
}

function prepareGrok(options: AgentSetupOptions, path: string): PreparedAgentFile[] {
  const prepared = readPrepared(path);
  const endpoints = endpointsForRegion(options.region);
  return [{
    agent: 'grok',
    path,
    ...prepared,
    after: updateToml(prepared.before, 'Grok config.toml', {}, [
      { name: 'models', entries: { default: 'minimax' } },
      {
        name: 'model.minimax',
        entries: {
          model: options.model,
          base_url: endpoints.openai,
          name: 'MiniMax',
          api_key: options.apiKey,
          api_backend: 'chat_completions',
          context_window: 1000000,
          max_completion_tokens: 512000,
        },
      },
    ]),
  }];
}

function prepareOpenCode(options: AgentSetupOptions, path: string): PreparedAgentFile[] {
  const prepared = readPrepared(path);
  const parsed = parseJsoncObject(prepared.before ?? '{}', 'OpenCode opencode.json');
  const provider = parsed.provider;
  if (provider !== undefined) {
    assertObject(
      provider,
      'OpenCode opencode.json provider section must be an object.',
    );
  }
  const minimax = provider?.minimax;
  if (minimax !== undefined) {
    assertObject(
      minimax,
      'OpenCode opencode.json provider.minimax section must be an object.',
    );
  }
  for (const [key, label] of [['options', 'options'], ['models', 'models']] as const) {
    const value = minimax?.[key];
    if (value !== undefined) {
      assertObject(
        value,
        `OpenCode opencode.json provider.minimax.${label} section must be an object.`,
      );
    }
  }
  const existingModel = (minimax?.models as Record<string, unknown> | undefined)?.[options.model];
  if (existingModel !== undefined) {
    assertObject(
      existingModel,
      `OpenCode model definition for ${options.model} must be an object.`,
    );
  }
  const endpoints = endpointsForRegion(options.region);
  return [{
    agent: 'opencode',
    path,
    ...prepared,
    after: updateJsonc(prepared.before, 'OpenCode opencode.json', [
      { path: ['provider', 'minimax', 'npm'], value: '@ai-sdk/openai-compatible' },
      { path: ['provider', 'minimax', 'name'], value: 'MiniMax' },
      { path: ['provider', 'minimax', 'options', 'baseURL'], value: endpoints.openai },
      { path: ['provider', 'minimax', 'options', 'apiKey'], value: options.apiKey },
      { path: ['provider', 'minimax', 'options', 'setCacheKey'], value: true },
      { path: ['provider', 'minimax', 'models', options.model, 'name'], value: options.model },
      { path: ['provider', 'minimax', 'models', options.model, 'limit', 'context'], value: 1000000 },
      { path: ['provider', 'minimax', 'models', options.model, 'limit', 'output'], value: 512000 },
      { path: ['model'], value: `minimax/${options.model}` },
    ]),
  }];
}

function prepareHermes(options: AgentSetupOptions, paths: string[]): PreparedAgentFile[] {
  const [yamlPath, envPath] = paths;
  if (!yamlPath || !envPath) throw new CLIError('Hermes paths are incomplete.', ExitCode.GENERAL);
  const yaml = readPrepared(yamlPath);
  const dotenv = readPrepared(envPath);
  const endpoints = endpointsForRegion(options.region);
  const provider = options.region === 'cn' ? 'minimax-cn' : 'minimax';
  const apiKeyName = options.region === 'cn' ? 'MINIMAX_CN_API_KEY' : 'MINIMAX_API_KEY';
  return [
    {
      agent: 'hermes',
      path: yamlPath,
      ...yaml,
      after: updateHermesYaml(yaml.before, provider, options.model, endpoints.anthropic),
    },
    {
      agent: 'hermes',
      path: envPath,
      ...dotenv,
      after: updateDotenv(dotenv.before, apiKeyName, options.apiKey),
    },
  ];
}

function preparePi(options: AgentSetupOptions, paths: string[]): PreparedAgentFile[] {
  const [modelsPath, settingsPath] = paths;
  if (!modelsPath || !settingsPath) throw new CLIError('Pi paths are incomplete.', ExitCode.GENERAL);
  const models = readPrepared(modelsPath);
  const settings = readPrepared(settingsPath);
  const parsed = parseJsoncObject(models.before ?? '{}', 'Pi models.json');
  const endpoints = endpointsForRegion(options.region);
  const providerId = options.region === 'cn' ? 'minimax-cn' : 'minimax';
  const modelDefinition = {
    id: options.model,
    name: options.model,
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 512000,
  };
  const providers = parsed.providers;
  if (providers !== undefined) {
    assertObject(
      providers,
      'Pi models.json providers section must be an object.',
    );
  }
  const provider = providers?.[providerId];
  if (provider !== undefined) {
    assertObject(
      provider,
      `Pi models.json providers.${providerId} section must be an object.`,
    );
  }
  const existingModels = provider?.models;
  if (existingModels !== undefined && !Array.isArray(existingModels)) {
    throw new CLIError(
      `Pi models.json providers.${providerId}.models must be an array.`,
      ExitCode.GENERAL,
      INVALID_CONFIG_HINT,
    );
  }
  const modelIndex = (existingModels as unknown[] | undefined)?.findIndex(
    (value) => typeof value === 'object'
      && value !== null
      && !Array.isArray(value)
      && (value as Record<string, unknown>).id === options.model,
  ) ?? -1;
  const modelPath: Array<string | number> = [
    'providers',
    providerId,
    'models',
    modelIndex >= 0 ? modelIndex : (existingModels as unknown[] | undefined)?.length ?? 0,
  ];
  const existingModel = modelIndex >= 0
    ? (existingModels as Array<Record<string, unknown>>)[modelIndex]
    : undefined;
  const existingCost = existingModel?.cost;
  if (existingCost !== undefined) {
    assertObject(
      existingCost,
      `Pi model definition for ${options.model} cost must be an object.`,
    );
  }
  const providerUpdates: Array<{ path: Array<string | number>; value: unknown }> = [
    { path: ['providers', providerId, 'name'], value: 'MiniMax' },
    { path: ['providers', providerId, 'baseUrl'], value: endpoints.openai },
    { path: ['providers', providerId, 'apiKey'], value: options.apiKey },
    { path: ['providers', providerId, 'api'], value: 'openai-completions' },
  ];
  if (modelIndex >= 0) {
    for (const [key, value] of Object.entries(modelDefinition)) {
      if (key !== 'cost') providerUpdates.push({ path: [...modelPath, key], value });
    }
    for (const [key, value] of Object.entries(modelDefinition.cost)) {
      providerUpdates.push({ path: [...modelPath, 'cost', key], value });
    }
  } else {
    providerUpdates.push({ path: modelPath, value: modelDefinition });
  }
  return [
    {
      agent: 'pi',
      path: modelsPath,
      ...models,
      after: updateJsonc(models.before, 'Pi models.json', providerUpdates),
    },
    {
      agent: 'pi',
      path: settingsPath,
      ...settings,
      after: updateJsonc(settings.before, 'Pi settings.json', [
        { path: ['defaultProvider'], value: providerId },
        { path: ['defaultModel'], value: options.model },
      ]),
    },
  ];
}

export function prepareAgentConfigurations(options: AgentSetupOptions): PreparedAgentFile[] {
  const prepared: PreparedAgentFile[] = [];
  for (const agent of options.agents) {
    const paths = configPathsForAgent(agent, options);
    switch (agent) {
      case 'claude-code':
        prepared.push(...prepareClaude(options, paths[0]!));
        break;
      case 'codex':
        prepared.push(...prepareCodex(options, paths[0]!));
        break;
      case 'grok':
        prepared.push(...prepareGrok(options, paths[0]!));
        break;
      case 'opencode':
        prepared.push(...prepareOpenCode(options, paths[0]!));
        break;
      case 'hermes':
        prepared.push(...prepareHermes(options, paths));
        break;
      case 'pi':
        prepared.push(...preparePi(options, paths));
        break;
    }
  }
  return prepared;
}

function atomicWritePrivate(path: string, contents: string): void {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = join(parent, `.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  try {
    writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function createBackup(path: string, timestamp: string): string {
  for (let suffix = 0; ; suffix += 1) {
    const backup = `${path}.bak.${timestamp}${suffix === 0 ? '' : `.${suffix}`}`;
    try {
      copyFileSync(path, backup, fsConstants.COPYFILE_EXCL);
      chmodSync(backup, 0o600);
      return backup;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      rmSync(backup, { force: true });
      throw error;
    }
  }
}

function backupTimestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.\d{3}Z$/, 'Z');
}

function writeTarget(path: string): string {
  let candidate = path;
  const missing: string[] = [];
  while (true) {
    try {
      return join(realpathSync(candidate), ...missing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      try {
        if (lstatSync(candidate).isSymbolicLink()) {
          throw new CLIError(
            `Configuration path contains a dangling symbolic link: ${path}`,
            ExitCode.GENERAL,
            'Fix the symbolic link and retry. No files were changed.',
          );
        }
      } catch (linkError) {
        if (linkError instanceof CLIError) throw linkError;
        if ((linkError as NodeJS.ErrnoException).code !== 'ENOENT') throw linkError;
      }
      const parent = dirname(candidate);
      if (parent === candidate) return resolve(path);
      missing.unshift(basename(candidate));
      candidate = parent;
    }
  }
}

function hasWeakPermissions(mode: number): boolean {
  return process.platform !== 'win32' && (mode & 0o077) !== 0;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function acquireAgentSetupLock(): () => void {
  const owner = typeof process.getuid === 'function'
    ? String(process.getuid())
    : (process.env.USERNAME ?? process.env.USER ?? 'user').replace(/[^A-Za-z0-9_-]/g, '_');
  const lockPath = join(tmpdir(), `mmx-agent-setup-${owner}.lock`);
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2)}`;

  try {
    const descriptor = openSync(lockPath, 'wx', 0o600);
    try {
      writeFileSync(descriptor, `${token}\n`, 'utf8');
    } catch (error) {
      closeSync(descriptor);
      if (readExisting(lockPath)?.trim() === token) rmSync(lockPath, { force: true });
      throw error;
    }
    return () => {
      closeSync(descriptor);
      if (readExisting(lockPath)?.trim() === token) rmSync(lockPath, { force: true });
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;

    const rawOwner = readExisting(lockPath)?.trim() ?? '';
    const pidMatch = rawOwner.match(/^(\d+):/);
    const pid = pidMatch?.[1] ? Number(pidMatch[1]) : undefined;
    const stale = pid !== undefined && !isProcessRunning(pid);
    throw new CLIError(
      stale ? 'A stale mmx agent setup lock exists.' : 'Another mmx agent setup is already running.',
      ExitCode.GENERAL,
      stale
        ? `Confirm no setup process is running, remove ${lockPath}, then retry. No files were changed.`
        : 'Wait for it to finish, then retry. No files were changed.',
    );
  }
}

export function applyAgentConfigurations(
  prepared: PreparedAgentFile[],
  dryRun = false,
): AppliedAgentFile[] {
  const releaseLock = dryRun ? undefined : acquireAgentSetupLock();
  try {
    const changed = prepared.filter((file) => file.before !== file.after);
    const targetOwners = new Map<string, string>();
    for (const file of prepared) {
      const target = file.targetPath;
      const owner = targetOwners.get(target);
      if (owner && owner !== file.path) {
        throw new CLIError(
          `Multiple agent configuration paths resolve to ${target}.`,
          ExitCode.GENERAL,
          'No files were changed. Use distinct configuration paths and retry.',
        );
      }
      targetOwners.set(target, file.path);
    }
    const originalModes = new Map<PreparedAgentFile, number>();
    const permissionOnly = new Map<PreparedAgentFile, number>();
    for (const file of prepared) {
      if (file.before !== null && existsSync(file.targetPath)) {
        const mode = statSync(file.targetPath).mode & 0o777;
        originalModes.set(file, mode);
        if (file.before === file.after && hasWeakPermissions(mode)) {
          permissionOnly.set(file, mode);
        }
      }
    }
    if (dryRun) {
      return prepared.map((file) => ({
        agent: file.agent,
        path: file.path,
        status: file.before === file.after && !permissionOnly.has(file)
          ? 'unchanged'
          : 'would-configure',
      }));
    }

    const assertStillCurrent = (file: PreparedAgentFile, hint: string): void => {
      if (writeTarget(file.path) !== file.targetPath
        || readExisting(file.targetPath) !== file.before) {
        throw new CLIError(
          `Configuration changed while mmx was preparing it: ${file.path}`,
          ExitCode.GENERAL,
          hint,
        );
      }
    };
    for (const file of prepared) {
      if (file.before !== file.after || permissionOnly.has(file)) {
        assertStillCurrent(file, 'No files were changed. Retry the command.');
      }
    }

    const timestamp = backupTimestamp();
    const backups = new Map<string, string>();
    const written: Array<{ file: PreparedAgentFile; target: string }> = [];
    try {
      for (const file of changed) {
        if (file.before !== null) {
          assertStillCurrent(file, 'No files were changed. Retry the command.');
          backups.set(file.path, createBackup(file.targetPath, timestamp));
        }
      }
      for (const file of prepared) {
        if (!permissionOnly.has(file)) continue;
        assertStillCurrent(file, 'The completed writes were rolled back. Retry the command.');
        chmodSync(file.targetPath, 0o600);
      }
      for (const file of changed) {
        assertStillCurrent(file, 'The completed writes were rolled back. Retry the command.');
        atomicWritePrivate(file.targetPath, file.after);
        written.push({ file, target: file.targetPath });
      }
    } catch (error) {
      const conflicts: string[] = [];
      let rollbackError: unknown;
      for (const { file, target } of written.reverse()) {
        try {
          if (readExisting(target) !== file.after) {
            conflicts.push(file.path);
            continue;
          }
          if (file.before === null) {
            rmSync(target, { force: true });
          } else {
            atomicWritePrivate(target, file.before);
            const mode = originalModes.get(file);
            if (mode !== undefined) chmodSync(target, mode);
          }
        } catch (candidate) {
          rollbackError ??= candidate;
        }
      }
      for (const [file, mode] of permissionOnly) {
        try {
          chmodSync(file.targetPath, mode);
        } catch (candidate) {
          rollbackError ??= candidate;
        }
      }
      if (conflicts.length === 0 && rollbackError === undefined) {
        for (const backup of backups.values()) {
          try {
            rmSync(backup, { force: true });
          } catch (candidate) {
            rollbackError ??= candidate;
          }
        }
      }
      if (conflicts.length > 0 || rollbackError !== undefined) {
        throw new CLIError(
          'Could not fully roll back agent configuration.',
          ExitCode.GENERAL,
          `Review the affected files${backups.size > 0
            ? ` and backups: ${[...backups.values()].join(', ')}`
            : '.'}`,
        );
      }
      throw error;
    }

    return prepared.map((file) => ({
      agent: file.agent,
      path: file.path,
      status: file.before === file.after && !permissionOnly.has(file)
        ? 'unchanged'
        : 'configured',
      ...(backups.has(file.path) ? { backup: backups.get(file.path) } : {}),
    }));
  } finally {
    releaseLock?.();
  }
}
