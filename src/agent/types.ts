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

export interface AgentSetupOptions {
  agents: AgentId[];
  apiKey: string;
  region: Region;
  model: string;
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
