import { spawn, spawnSync } from 'child_process';

import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import type { AgentId } from './types';

type NpmAgentId = Exclude<AgentId, 'grok' | 'hermes'>;

const NPM_PACKAGES: Record<NpmAgentId, string> = {
  'claude-code': '@anthropic-ai/claude-code@latest',
  codex: '@openai/codex',
  opencode: 'opencode-ai',
  pi: '@earendil-works/pi-coding-agent',
};

const AGENT_EXECUTABLES: Record<NpmAgentId, string> = {
  'claude-code': 'claude',
  codex: 'codex',
  opencode: 'opencode',
  pi: 'pi',
};

const SUPPORTED_PLATFORMS = new Set<NodeJS.Platform>(['darwin', 'linux', 'win32']);
const SUPPORTED_NATIVE_ARCHITECTURES = new Set(['arm64', 'x64']);

export interface AgentInstallCommand {
  executable: string;
  args: string[];
  display: string;
}

export interface AgentInstallEnvironment {
  platform?: NodeJS.Platform;
  arch?: string;
  nodeVersion?: string;
  commandExists?: (executable: string) => boolean;
}

export type AgentInstallRunner = (command: AgentInstallCommand) => Promise<number>;

function defaultCommandExists(executable: string, platform: NodeJS.Platform): boolean {
  const command = platform === 'win32' ? 'where.exe' : executable;
  const args = platform === 'win32' ? [executable] : ['--version'];
  return spawnSync(command, args, { stdio: 'ignore', timeout: 5_000 }).status === 0;
}

export function getAgentInstallIssue(
  agent: AgentId,
  environment: AgentInstallEnvironment = {},
): string | undefined {
  if (agent === 'grok') {
    return 'The official Grok installer also changes Grok configuration; install it manually from '
      + 'https://docs.x.ai/build/overview.';
  }
  if (agent === 'hermes') {
    return 'The official Hermes installer also changes shell configuration; install it manually from '
      + 'https://github.com/NousResearch/hermes-agent.';
  }

  const platform = environment.platform ?? process.platform;
  const arch = environment.arch ?? process.arch;
  const nodeVersion = environment.nodeVersion ?? process.versions.node;
  const commandExists = environment.commandExists
    ?? ((executable: string) => defaultCommandExists(executable, platform));

  if (!SUPPORTED_PLATFORMS.has(platform)) {
    return `Automated installation is not supported on ${platform}.`;
  }
  if (agent !== 'pi' && !SUPPORTED_NATIVE_ARCHITECTURES.has(arch)) {
    return `Automated installation is not supported on ${platform}/${arch}.`;
  }
  if (agent === 'pi') {
    const [major = 0, minor = 0] = nodeVersion.replace(/^v/, '').split('.').map(Number);
    if (major < 22 || (major === 22 && minor < 19)) {
      return `Pi requires Node.js 22.19 or newer (current: ${nodeVersion}).`;
    }
  }
  const requirements = platform === 'win32' ? ['cmd.exe', 'npm'] : ['npm'];
  const missing = requirements.filter(executable => !commandExists(executable));
  if (missing.length > 0) return `Required command not found on PATH: ${missing.join(', ')}.`;
  return undefined;
}

function unavailableInstaller(agent: Extract<AgentId, 'grok' | 'hermes'>): never {
  throw new CLIError(
    `${agent} has no configuration-safe automated installer.`,
    ExitCode.GENERAL,
    getAgentInstallIssue(agent),
  );
}

export function getAgentInstallCommand(
  agent: AgentId,
  platform: NodeJS.Platform = process.platform,
): AgentInstallCommand {
  if (agent === 'grok' || agent === 'hermes') return unavailableInstaller(agent);

  const args = [
    'install',
    '-g',
    ...(agent === 'pi' ? ['--ignore-scripts', '--engine-strict'] : []),
    NPM_PACKAGES[agent],
  ];
  const display = `npm ${args.join(' ')}`;
  if (platform === 'win32') {
    return {
      executable: 'cmd.exe',
      args: ['/d', '/s', '/c', display],
      display,
    };
  }
  return { executable: 'npm', args, display };
}

export function getAgentVerificationCommand(
  agent: NpmAgentId,
  platform: NodeJS.Platform = process.platform,
): AgentInstallCommand {
  const display = `${AGENT_EXECUTABLES[agent]} --version`;
  if (platform === 'win32') {
    return {
      executable: 'cmd.exe',
      args: ['/d', '/s', '/c', display],
      display,
    };
  }
  return { executable: AGENT_EXECUTABLES[agent], args: ['--version'], display };
}

async function runAgentInstallCommand(command: AgentInstallCommand): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command.executable, command.args, {
      stdio: ['inherit', process.stderr, 'inherit'],
    });
    child.once('error', reject);
    child.once('exit', code => resolvePromise(code ?? 1));
  });
}

export async function installAgent(
  agent: AgentId,
  options: AgentInstallEnvironment & { runner?: AgentInstallRunner } = {},
): Promise<void> {
  const issue = getAgentInstallIssue(agent, options);
  if (issue) {
    throw new CLIError(
      `Cannot install ${agent}: ${issue}`,
      ExitCode.GENERAL,
      'Leave it unselected and continue with configuration only.',
    );
  }
  const installableAgent = agent as NpmAgentId;
  const command = getAgentInstallCommand(installableAgent, options.platform);
  const verificationCommand = getAgentVerificationCommand(installableAgent, options.platform);
  const hint = `Run the installer manually:\n${command.display}\nFor npm permission errors, see: `
    + 'https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally';
  const runner = options.runner ?? runAgentInstallCommand;

  let exitCode: number;
  try {
    exitCode = await runner(command);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : '';
    throw new CLIError(
      `Could not start the installer for ${agent}.${detail}`,
      ExitCode.GENERAL,
      hint,
    );
  }
  if (exitCode !== 0) {
    throw new CLIError(
      `Failed to install ${agent} (installer exited with code ${exitCode}).`,
      ExitCode.GENERAL,
      hint,
    );
  }

  let verificationExitCode: number;
  try {
    verificationExitCode = await runner(verificationCommand);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : '';
    throw new CLIError(
      `Installed ${agent}, but could not start ${verificationCommand.display}.${detail}`,
      ExitCode.GENERAL,
      `Open a new terminal and verify the installation manually:\n${verificationCommand.display}`,
    );
  }
  if (verificationExitCode !== 0) {
    throw new CLIError(
      `Installed ${agent}, but ${verificationCommand.display} exited with code ${verificationExitCode}.`,
      ExitCode.GENERAL,
      `Open a new terminal and verify the installation manually:\n${verificationCommand.display}`,
    );
  }
}
