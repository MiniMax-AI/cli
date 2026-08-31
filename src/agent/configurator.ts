import {
  chmodSync,
  closeSync,
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
import {
  MINIMAX_MODELS,
  type AgentId,
  type AgentSetupOptions,
  type AppliedAgentFile,
  type MiniMaxModelId,
  type PreparedAgentFile,
} from './types';

const JSON_FORMATTING = { insertSpaces: true, tabSize: 2, eol: '\n' };
const TOML_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
const CODEX_MODEL_CATALOG_FILENAME = 'mmx-model-catalog.json';
const CODEX_MODEL_CATALOG_OWNER = 'mmx agent setup';
const INVALID_CONFIG_HINT = 'Fix the existing configuration file and retry. No files were changed.';

function minimaxModel(modelId: MiniMaxModelId) {
  const model = MINIMAX_MODELS.find(candidate => candidate.id === modelId);
  if (!model) throw new CLIError(`Unsupported MiniMax model: ${modelId}`, ExitCode.USAGE);
  return model;
}

function claudeModelId(modelId: MiniMaxModelId): string {
  return modelId === 'MiniMax-M3' ? `${modelId}[1m]` : modelId;
}

function grokModelProfile(modelId: MiniMaxModelId): string {
  return modelId === 'MiniMax-M3'
    ? 'minimax'
    : modelId.toLowerCase().replaceAll('.', '-');
}

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
      return [join(dir, 'config.toml'), join(dir, CODEX_MODEL_CATALOG_FILENAME)];
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
      const dir = pathFromOverride(env.HERMES_HOME, join(home, '.hermes'), home);
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
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
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
  model: MiniMaxModelId,
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
  if (typeof root.model === 'string') {
    document.deleteIn(['model']);
  } else if (root.model !== undefined) {
    assertObject(
      root.model,
      'Hermes config.yaml model section must be an object.',
    );
  }
  if (root.providers !== undefined) {
    assertObject(
      root.providers,
      'Hermes config.yaml providers section must be an object.',
    );
  }
  if (root.agent !== undefined) {
    assertObject(
      root.agent,
      'Hermes config.yaml agent section must be an object.',
    );
  }
  const reasoningOverrides = (root.agent as Record<string, unknown> | undefined)
    ?.reasoning_overrides;
  if (reasoningOverrides !== undefined) {
    assertObject(
      reasoningOverrides,
      'Hermes config.yaml agent.reasoning_overrides section must be an object.',
    );
  }
  const providerConfig = (root.providers as Record<string, unknown> | undefined)?.[provider];
  if (providerConfig !== undefined) {
    assertObject(
      providerConfig,
      `Hermes config.yaml providers.${provider} section must be an object.`,
    );
  }
  const configuredModels = (providerConfig as Record<string, unknown> | undefined)?.models;
  if (configuredModels !== undefined
    && !Array.isArray(configuredModels)
    && (typeof configuredModels !== 'object' || configuredModels === null)) {
    throw new CLIError(
      `Hermes config.yaml providers.${provider}.models must be an object or array.`,
      ExitCode.GENERAL,
      INVALID_CONFIG_HINT,
    );
  }
  if (Array.isArray(configuredModels)) {
    const configuredIds = new Set(configuredModels.flatMap((entry) => {
      if (typeof entry === 'string') return [entry];
      if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
        const id = (entry as Record<string, unknown>).id;
        return typeof id === 'string' ? [id] : [];
      }
      return [];
    }));
    for (const candidate of MINIMAX_MODELS) {
      if (!configuredIds.has(candidate.id)) {
        document.addIn(
          ['providers', provider, 'models'],
          { id: candidate.id, context_length: candidate.contextWindow },
        );
      }
    }
  } else {
    const modelMap = configuredModels as Record<string, unknown> | undefined;
    for (const candidate of MINIMAX_MODELS) {
      if (modelMap?.[candidate.id] !== undefined) {
        assertObject(
          modelMap[candidate.id],
          `Hermes model definition for ${candidate.id} must be an object.`,
        );
      }
      document.setIn(
        ['providers', provider, 'models', candidate.id, 'context_length'],
        candidate.contextWindow,
      );
    }
  }
  const selectedModel = minimaxModel(model);
  document.setIn(['model', 'default'], model);
  document.setIn(['model', 'provider'], provider);
  document.setIn(['model', 'base_url'], baseUrl);
  document.setIn(['model', 'context_length'], selectedModel.contextWindow);
  document.setIn(['model', 'max_tokens'], selectedModel.maxTokens);
  if ((reasoningOverrides as Record<string, unknown> | undefined)?.['MiniMax-M3'] === undefined) {
    // Hermes currently serializes enabled MiniMax thinking with the legacy
    // budget-based shape. Omitting thinking is the safe M3 default.
    document.setIn(['agent', 'reasoning_overrides', 'MiniMax-M3'], 'none');
  }
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
  const parsed = parseJsoncObject(prepared.before ?? '{}', 'Claude Code settings.json');
  const existingPicker = parsed.modelPicker;
  if (existingPicker !== undefined) {
    assertObject(
      existingPicker,
      'Claude Code settings.json modelPicker section must be an object.',
    );
  }
  const existingPickerOptions = existingPicker?.options;
  if (existingPickerOptions !== undefined && !Array.isArray(existingPickerOptions)) {
    throw new CLIError(
      'Claude Code settings.json modelPicker.options must be an array.',
      ExitCode.GENERAL,
      INVALID_CONFIG_HINT,
    );
  }
  const existingReplaceBuiltIns = existingPicker?.replaceBuiltInOptions;
  if (existingReplaceBuiltIns !== undefined && typeof existingReplaceBuiltIns !== 'boolean') {
    throw new CLIError(
      'Claude Code settings.json modelPicker.replaceBuiltInOptions must be a boolean.',
      ExitCode.GENERAL,
      INVALID_CONFIG_HINT,
    );
  }
  const endpoints = endpointsForRegion(options.region);
  const model = claudeModelId(options.model);
  const pickerOptions = MINIMAX_MODELS.map(candidate => ({
    model: claudeModelId(candidate.id),
    label: candidate.id,
    description: candidate.id.endsWith('-highspeed')
      ? '204.8K context · faster inference'
      : `${candidate.contextWindow === 1000000 ? '1M' : '204.8K'} context`,
  }));
  const managedPickerModels = new Set(MINIMAX_MODELS.flatMap(candidate => [
    candidate.id,
    claudeModelId(candidate.id),
  ]));
  const pickerUpdates: Array<{ path: Array<string | number>; value: unknown }> = [];
  if (existingPickerOptions === undefined) {
    pickerUpdates.push({ path: ['modelPicker', 'options'], value: pickerOptions });
  } else {
    const managedIndexes = existingPickerOptions.flatMap((entry, index) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
      const entryModel = (entry as Record<string, unknown>).model;
      return typeof entryModel === 'string' && managedPickerModels.has(entryModel) ? [index] : [];
    });
    for (const index of managedIndexes.reverse()) {
      pickerUpdates.push({ path: ['modelPicker', 'options', index], value: undefined });
    }
    const firstNewIndex = existingPickerOptions.length - managedIndexes.length;
    pickerOptions.forEach((value, index) => {
      pickerUpdates.push({ path: ['modelPicker', 'options', firstNewIndex + index], value });
    });
  }
  const env = {
    ANTHROPIC_BASE_URL: endpoints.anthropic,
    ANTHROPIC_AUTH_TOKEN: options.apiKey,
    API_TIMEOUT_MS: '3000000',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(minimaxModel(options.model).contextWindow),
    ANTHROPIC_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: claudeModelId('MiniMax-M2.7'),
    ANTHROPIC_DEFAULT_OPUS_MODEL: claudeModelId('MiniMax-M3'),
    ANTHROPIC_DEFAULT_HAIKU_MODEL: claudeModelId('MiniMax-M2.7-highspeed'),
  };
  return [{
    agent: 'claude-code',
    path,
    ...prepared,
    after: updateJsonc(prepared.before, 'Claude Code settings.json', [
      ...Object.entries(env).map(([key, value]) => ({ path: ['env', key], value })),
      ...pickerUpdates,
      {
        path: ['modelPicker', 'replaceBuiltInOptions'],
        value: existingReplaceBuiltIns ?? true,
      },
    ]),
  }];
}

function codexModelCatalog(): string {
  return `${JSON.stringify({
    _managed_by: CODEX_MODEL_CATALOG_OWNER,
    models: MINIMAX_MODELS.map((model, priority) => ({
      slug: model.id,
      display_name: model.id,
      description: 'MiniMax',
      default_reasoning_level: 'high',
      supported_reasoning_levels: model.id === 'MiniMax-M3'
        ? [
          { effort: 'none', description: 'Think-Off' },
          { effort: 'high', description: 'Deep' },
        ]
        : [{ effort: 'high', description: 'Always on' }],
      shell_type: 'shell_command',
      visibility: 'list',
      supported_in_api: true,
      priority,
      base_instructions: `You are Codex, a coding agent based on ${model.id}. You and the user share the same workspace and collaborate to achieve the user's goals.`,
      supports_reasoning_summaries: true,
      default_reasoning_summary: 'none',
      support_verbosity: false,
      truncation_policy: { mode: 'bytes', limit: 10000 },
      supports_parallel_tool_calls: true,
      experimental_supported_tools: [],
      context_window: model.contextWindow,
      max_context_window: model.contextWindow,
      input_modalities: [...model.input],
    })),
  }, null, 2)}\n`;
}

function prepareCodex(options: AgentSetupOptions, paths: string[]): PreparedAgentFile[] {
  const [configPath, catalogPath] = paths;
  if (!configPath || !catalogPath) {
    throw new CLIError('Codex paths are incomplete.', ExitCode.GENERAL);
  }
  const config = readPrepared(configPath);
  const endpoints = endpointsForRegion(options.region);
  let configAfter = updateToml(config.before, 'Codex config.toml', {
    model: options.model,
    model_provider: 'minimax',
  }, [{
    name: 'model_providers.minimax',
    entries: {
      name: 'MiniMax',
      base_url: endpoints.openai,
      experimental_bearer_token: options.apiKey,
      wire_api: 'responses',
    },
  }]);
  const configuredCatalog = parseToml(configAfter).model_catalog_json;
  if (configuredCatalog !== undefined && configuredCatalog !== CODEX_MODEL_CATALOG_FILENAME) {
    throw new CLIError(
      'Codex config.toml already uses a user-managed model catalog.',
      ExitCode.GENERAL,
      'Remove model_catalog_json to let mmx manage a MiniMax-only catalog, or configure Codex manually. No files were changed.',
    );
  }

  const catalog = readPrepared(catalogPath);
  if (catalog.before !== null) {
    const root = parseJsoncObject(catalog.before, 'Codex mmx-model-catalog.json');
    if (root._managed_by !== CODEX_MODEL_CATALOG_OWNER) {
      throw new CLIError(
        `Codex ${CODEX_MODEL_CATALOG_FILENAME} is not managed by mmx.`,
        ExitCode.GENERAL,
        'Rename or remove that file, then retry. No files were changed.',
      );
    }
  }
  configAfter = upsertTomlRoot(configAfter, {
    model_catalog_json: CODEX_MODEL_CATALOG_FILENAME,
  });
  return [
    {
      agent: 'codex',
      path: configPath,
      ...config,
      after: configAfter,
    },
    {
      agent: 'codex',
      path: catalogPath,
      ...catalog,
      after: codexModelCatalog(),
    },
  ];
}

function prepareGrok(options: AgentSetupOptions, path: string): PreparedAgentFile[] {
  const prepared = readPrepared(path);
  const endpoints = endpointsForRegion(options.region);
  const sections = MINIMAX_MODELS.map(model => ({
    name: `model.${grokModelProfile(model.id)}`,
    entries: {
      model: model.id,
      base_url: endpoints.openai,
      name: model.id,
      api_key: options.apiKey,
      api_backend: 'chat_completions',
      context_window: model.contextWindow,
      max_completion_tokens: model.maxTokens,
    },
  }));
  return [{
    agent: 'grok',
    path,
    ...prepared,
    after: updateToml(prepared.before, 'Grok config.toml', {}, [
      { name: 'models', entries: { default: grokModelProfile(options.model) } },
      ...sections,
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
  for (const key of ['options', 'models'] as const) {
    const value = minimax?.[key];
    if (value !== undefined) {
      assertObject(
        value,
        `OpenCode opencode.json provider.minimax.${key} section must be an object.`,
      );
    }
  }
  const configuredModels = minimax?.models as Record<string, unknown> | undefined;
  for (const model of MINIMAX_MODELS) {
    const configuredModel = configuredModels?.[model.id];
    if (configuredModel !== undefined) {
      assertObject(
        configuredModel,
        `OpenCode model definition for ${model.id} must be an object.`,
      );
    }
    const limit = (configuredModel as Record<string, unknown> | undefined)?.limit;
    if (limit !== undefined) {
      assertObject(
        limit,
        `OpenCode model definition for ${model.id} limit must be an object.`,
      );
    }
    const modalities = (configuredModel as Record<string, unknown> | undefined)?.modalities;
    if (modalities !== undefined) {
      assertObject(
        modalities,
        `OpenCode model definition for ${model.id} modalities must be an object.`,
      );
    }
  }
  const endpoints = endpointsForRegion(options.region);
  const modelUpdates = MINIMAX_MODELS.flatMap((model) => {
    const input: Array<'text' | 'image'> = [...model.input];
    return [
      { path: ['provider', 'minimax', 'models', model.id, 'name'], value: model.id },
      {
        path: ['provider', 'minimax', 'models', model.id, 'attachment'],
        value: input.includes('image'),
      },
      {
        path: ['provider', 'minimax', 'models', model.id, 'modalities', 'input'],
        value: input,
      },
      {
        path: ['provider', 'minimax', 'models', model.id, 'modalities', 'output'],
        value: ['text'],
      },
      {
        path: ['provider', 'minimax', 'models', model.id, 'limit', 'context'],
        value: model.contextWindow,
      },
      {
        path: ['provider', 'minimax', 'models', model.id, 'limit', 'output'],
        value: model.maxTokens,
      },
    ];
  });
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
      ...modelUpdates,
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
  const providerUpdates: Array<{ path: Array<string | number>; value: unknown }> = [
    { path: ['providers', providerId, 'name'], value: 'MiniMax' },
    { path: ['providers', providerId, 'baseUrl'], value: endpoints.anthropic },
    { path: ['providers', providerId, 'apiKey'], value: options.apiKey },
    { path: ['providers', providerId, 'api'], value: 'anthropic-messages' },
  ];
  const modelDefinitions = MINIMAX_MODELS.map(model => ({
    id: model.id,
    name: model.id,
    reasoning: true,
    ...(model.id === 'MiniMax-M3'
      ? { compat: { forceAdaptiveThinking: true } }
      : { thinkingLevelMap: { off: null } }),
    input: [...model.input],
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  }));
  if (existingModels === undefined) {
    providerUpdates.push({
      path: ['providers', providerId, 'models'],
      value: modelDefinitions,
    });
  } else {
    let appendIndex = existingModels.length;
    for (const definition of modelDefinitions) {
      const modelIndex = existingModels.findIndex(
        entry => typeof entry === 'object'
          && entry !== null
          && !Array.isArray(entry)
          && (entry as Record<string, unknown>).id === definition.id,
      );
      const modelPath: Array<string | number> = [
        'providers',
        providerId,
        'models',
        modelIndex >= 0 ? modelIndex : appendIndex++,
      ];
      if (modelIndex < 0) {
        providerUpdates.push({ path: modelPath, value: definition });
        continue;
      }
      assertObject(
        existingModels[modelIndex],
        `Pi model definition for ${definition.id} must be an object.`,
      );
      for (const [key, value] of Object.entries(definition)) {
        if (key === 'id') continue;
        if (key === 'compat' || key === 'thinkingLevelMap') {
          const existing = existingModels[modelIndex][key];
          if (existing !== undefined) {
            assertObject(existing, `Pi ${key} for ${definition.id} must be an object.`);
          }
          for (const [nestedKey, nestedValue] of Object.entries(value)) {
            providerUpdates.push({
              path: [...modelPath, key, nestedKey],
              value: nestedValue,
            });
          }
          continue;
        }
        providerUpdates.push({ path: [...modelPath, key], value });
      }
    }
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
        prepared.push(...prepareCodex(options, paths));
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
  assertDistinctConfigurationTargets(prepared);
  return prepared;
}

function atomicWritePrivate(path: string, contents: string, logicalPath: string): void {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = join(parent, `.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  const assertTarget = () => {
    if (writeTarget(logicalPath) !== path) {
      throw new CLIError(
        `Configuration path changed while mmx was writing it: ${logicalPath}`,
        ExitCode.GENERAL,
      );
    }
  };
  try {
    assertTarget();
    writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    assertTarget();
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function createBackup(path: string, contents: string, timestamp: string): string {
  for (let suffix = 0; ; suffix += 1) {
    const backup = `${path}.bak.${timestamp}${suffix === 0 ? '' : `.${suffix}`}`;
    try {
      writeFileSync(backup, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
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

function assertDistinctConfigurationTargets(prepared: PreparedAgentFile[]): void {
  const targets = new Set<string>();
  for (const file of prepared) {
    if (targets.has(file.targetPath)) {
      throw new CLIError(
        `Multiple agent configuration paths resolve to ${file.targetPath}.`,
        ExitCode.GENERAL,
        'No files were changed. Use distinct configuration paths and retry.',
      );
    }
    targets.add(file.targetPath);
  }
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
    let released = false;
    return () => {
      if (released) return;
      released = true;
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

export async function withAgentSetupLock<T>(task: () => Promise<T>): Promise<T> {
  const releaseLock = acquireAgentSetupLock();
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  const removeSignalHandlers = () => {
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler);
    }
  };
  for (const [signal, exitCode] of [
    ['SIGHUP', 129],
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const) {
    const handler = () => {
      removeSignalHandlers();
      releaseLock();
      process.exit(exitCode);
    };
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }
  process.once('exit', releaseLock);
  try {
    return await task();
  } finally {
    process.off('exit', releaseLock);
    removeSignalHandlers();
    releaseLock();
  }
}

export function applyAgentConfigurations(
  prepared: PreparedAgentFile[],
  dryRun = false,
  lockHeld = false,
): AppliedAgentFile[] {
  const releaseLock = dryRun || lockHeld ? undefined : acquireAgentSetupLock();
  try {
    const changed = prepared.filter((file) => file.before !== file.after);
    assertDistinctConfigurationTargets(prepared);
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
          backups.set(file.path, createBackup(file.targetPath, file.before, timestamp));
        }
      }
      for (const file of prepared) {
        if (!permissionOnly.has(file)) continue;
        assertStillCurrent(file, 'The completed writes were rolled back. Retry the command.');
        chmodSync(file.targetPath, 0o600);
      }
      for (const file of changed) {
        assertStillCurrent(file, 'The completed writes were rolled back. Retry the command.');
        atomicWritePrivate(file.targetPath, file.after, file.path);
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
            atomicWritePrivate(target, file.before, file.path);
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
