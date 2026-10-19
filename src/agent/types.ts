import type { Region } from '../config/schema';
import { DEFAULT_TEXT_MODEL } from '../config/models';

export const AGENT_IDS = [
  'claude-code',
  'codex',
  'grok',
  'opencode',
  'hermes',
  'pi',
  'oh-my-pi',
] as const;

export type AgentId = typeof AGENT_IDS[number];

export const MINIMAX_MODELS = [
  {
    id: DEFAULT_TEXT_MODEL,
    contextWindow: 524288,
    maxTokens: 128000,
    input: ['text', 'image'],
    codex: {
      defaultReasoningLevel: 'max',
      supportedReasoningLevels: [
        { effort: 'low', description: 'Low' },
        { effort: 'medium', description: 'Medium' },
        { effort: 'high', description: 'High' },
        { effort: 'xhigh', description: 'Extra high' },
        { effort: 'max', description: 'Maximum' },
      ],
    },
  },
  {
    id: 'MiniMax-M3',
    contextWindow: 1_000_000,
    maxTokens: 128000,
    input: ['text', 'image'],
    codex: {
      defaultReasoningLevel: 'high',
      supportedReasoningLevels: [
        { effort: 'none', description: 'Think-Off' },
        { effort: 'high', description: 'Deep' },
      ],
    },
  },
] as const;

export const DEFAULT_MINIMAX_MODEL = MINIMAX_MODELS[0].id;
export type MiniMaxModelId = typeof MINIMAX_MODELS[number]['id'];

export interface AgentSetupOptions {
  agents: AgentId[];
  apiKey: string;
  region: Region;
  model: MiniMaxModelId;
  m31ContextWindow?: 524288 | 1_000_000;
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
