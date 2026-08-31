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
