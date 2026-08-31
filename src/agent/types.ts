import type { Region } from '../config/schema';

export const AGENT_IDS = [
  'claude-code',
  'codex',
  'grok',
  'opencode',
  'hermes',
  'pi',
] as const;

export type AgentId = typeof AGENT_IDS[number];

export const MINIMAX_MODELS = [
  {
    id: 'MiniMax-M3',
    contextWindow: 1000000,
    maxTokens: 128000,
    input: ['text', 'image'],
  },
  {
    id: 'MiniMax-M2.7',
    contextWindow: 204800,
    maxTokens: 131072,
    input: ['text'],
  },
  {
    id: 'MiniMax-M2.7-highspeed',
    contextWindow: 204800,
    maxTokens: 131072,
    input: ['text'],
  },
] as const;

export const DEFAULT_MINIMAX_MODEL = MINIMAX_MODELS[0].id;
export type MiniMaxModelId = typeof MINIMAX_MODELS[number]['id'];

export interface AgentSetupOptions {
  agents: AgentId[];
  apiKey: string;
  region: Region;
  model: MiniMaxModelId;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}

export interface PreparedAgentFile {
  agent: AgentId;
  path: string;
  targetPath: string;
  before: string | null;
  after: string;
}

export interface AppliedAgentFile {
  agent: AgentId;
  path: string;
  status: 'configured' | 'unchanged' | 'would-configure';
  backup?: string;
}

export interface AgentVerification {
  region: Region;
  model: string;
  endpoint: string;
  status: 'ok' | 'skipped';
}
