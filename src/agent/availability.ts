import { accessSync, constants, statSync } from 'fs';
import { delimiter, join } from 'path';

import { AGENT_IDS, type AgentId } from './types';

const AGENT_EXECUTABLES: Record<AgentId, readonly string[]> = {
  'claude-code': ['claude'],
  codex: ['codex'],
  grok: ['grok', 'grok-build', 'grok-cli'],
  opencode: ['opencode'],
  hermes: ['hermes'],
  pi: ['pi'],
};

const AGENT_RUNTIME_MARKERS: Partial<Record<AgentId, readonly [string, string]>> = {
  'claude-code': ['CLAUDE_CODE_CHILD_SESSION', '1'],
  opencode: ['OPENCODE_CLIENT', 'desktop'],
  hermes: ['HERMES_AGENT', 'true'],
  pi: ['PI_CODING_AGENT', 'true'],
};

export function detectAgentsOnPath(env: NodeJS.ProcessEnv = process.env): Set<AgentId> {
  const pathValue = process.platform === 'win32' ? env.PATH ?? env.Path : env.PATH;
  if (pathValue === undefined) return new Set();
  const directories = pathValue
    .split(delimiter)
    .map((directory) => directory.replace(/^"|"$/g, ''));
  const extensions = process.platform === 'win32'
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';')
    : [''];
  const accessMode = process.platform === 'win32' ? constants.F_OK : constants.X_OK;

  return new Set(AGENT_IDS.filter((agent) => AGENT_EXECUTABLES[agent].some(
    (command) => directories.some((directory) => extensions.some((extension) => {
      const candidate = join(directory, `${command}${extension}`);
      try {
        if (!statSync(candidate).isFile()) return false;
        accessSync(candidate, accessMode);
        return true;
      } catch {
        return false;
      }
    })),
  )));
}

export function detectAvailableAgents(env: NodeJS.ProcessEnv = process.env): Set<AgentId> {
  const agents = detectAgentsOnPath(env);
  if (env.CODEX_THREAD_ID?.trim()) agents.add('codex');
  for (const agent of AGENT_IDS) {
    const marker = AGENT_RUNTIME_MARKERS[agent];
    if (marker !== undefined && env[marker[0]] === marker[1]) agents.add(agent);
  }
  return agents;
}
