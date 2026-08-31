import { spawn, spawnSync, type ChildProcess } from 'child_process';

import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import type { AgentId } from './types';

type NpmAgentId = Extract<AgentId, 'codex' | 'opencode' | 'pi'>;
type ScriptAgentId = Exclude<AgentId, NpmAgentId>;

const NPM_PACKAGES: Record<NpmAgentId, string> = {
  codex: '@openai/codex',
  opencode: 'opencode-ai',
  pi: '@earendil-works/pi-coding-agent',
};

const AGENT_EXECUTABLES: Record<NpmAgentId, string> = {
  codex: 'codex',
  opencode: 'opencode',
  pi: 'pi',
};

const INSTALLER_URLS: Record<ScriptAgentId, string> = {
  'claude-code': 'https://claude.ai/install.sh',
  grok: 'https://x.ai/cli/install.sh',
  hermes: 'https://hermes-agent.nousresearch.com/install.sh',
};

const WINDOWS_INSTALLER_URLS: Record<ScriptAgentId, string> = {
  'claude-code': 'https://claude.ai/install.ps1',
  grok: 'https://x.ai/cli/install.ps1',
  hermes: 'https://hermes-agent.nousresearch.com/install.ps1',
};

const HERMES_POSIX_STAGES = [
  'repository',
  'venv',
  'python-deps',
  'path',
  'config',
  'complete',
];

const HERMES_WINDOWS_STAGES = [
  'uv',
  'python',
  'git',
  'repository',
  'venv',
  'dependencies',
  'path',
  'config-templates',
  'bootstrap-marker',
];

const SUPPORTED_PLATFORMS = new Set<NodeJS.Platform>(['darwin', 'linux', 'win32']);
const SUPPORTED_NATIVE_ARCHITECTURES = new Set(['arm64', 'x64']);
const PROXY_ENV_KEYS = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
] as const;
const POWERSHELL_PROXY_SETUP = '$proxyUrl = @($env:HTTPS_PROXY, $env:https_proxy, '
  + '$env:HTTP_PROXY, $env:http_proxy, $env:ALL_PROXY, $env:all_proxy) '
  + '| Where-Object { $_ -and $_.Trim() } | Select-Object -First 1; '
  + 'if ($proxyUrl) { $webProxy = [System.Net.WebProxy]::new($proxyUrl); '
  + '$webProxy.Credentials = [System.Net.CredentialCache]::DefaultNetworkCredentials; '
  + '[System.Net.WebRequest]::DefaultWebProxy = $webProxy }; ';
const DEFAULT_INSTALL_TIMEOUT_MS = 15 * 60_000;
const VERIFICATION_TIMEOUT_MS = 30_000;

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
  proxy?: string;
  installTimeoutMs?: number;
}

export type AgentInstallRunner = (command: AgentInstallCommand) => Promise<number>;

interface AgentInstallRunOptions {
  proxy?: string;
  timeoutMs: number;
}

class AgentInstallTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
    this.name = 'AgentInstallTimeoutError';
  }
}

function defaultCommandExists(executable: string, platform: NodeJS.Platform): boolean {
  const command = platform === 'win32' ? 'where.exe' : executable;
  const args = platform === 'win32' ? [executable] : ['--version'];
  return spawnSync(command, args, { stdio: 'ignore', timeout: 5_000 }).status === 0;
}

export function getAgentInstallIssue(
  agent: AgentId,
  environment: AgentInstallEnvironment = {},
): string | undefined {
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
  if (agent === 'hermes' && platform === 'darwin' && arch !== 'arm64') {
    return 'Hermes automated installation is supported on macOS Apple Silicon only.';
  }
  if (agent === 'pi') {
    const [major = 0, minor = 0] = nodeVersion.replace(/^v/, '').split('.').map(Number);
    if (major < 22 || (major === 22 && minor < 19)) {
      return `Pi requires Node.js 22.19 or newer (current: ${nodeVersion}).`;
    }
  }
  const requirements = agent === 'claude-code' || agent === 'grok'
    ? platform === 'win32' ? ['powershell.exe'] : ['bash', 'curl']
    : agent === 'hermes'
      ? platform === 'win32' ? ['powershell.exe'] : ['bash', 'curl', 'git']
      : platform === 'win32' ? ['cmd.exe', 'npm'] : ['npm'];
  const missing = requirements.filter(executable => !commandExists(executable));
  if (missing.length > 0) return `Required command not found on PATH: ${missing.join(', ')}.`;
  return undefined;
}

function getScriptInstallCommand(
  agent: ScriptAgentId,
  platform: NodeJS.Platform,
): AgentInstallCommand {
  if (platform === 'win32') {
    const url = WINDOWS_INSTALLER_URLS[agent];
    if (agent !== 'hermes') {
      const script = POWERSHELL_PROXY_SETUP
        + `$installer = Invoke-RestMethod '${url}'; `
        + '& ([scriptblock]::Create($installer))';
      return {
        executable: 'powershell.exe',
        args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
        display: `irm ${url} | iex`,
      };
    }
    const stages = HERMES_WINDOWS_STAGES.map(stage => `'${stage}'`).join(', ');
    const childCommand = `& { ${POWERSHELL_PROXY_SETUP}`
      + '& $env:MMX_HERMES_INSTALLER -Stage $env:MMX_HERMES_STAGE '
      + '-NonInteractive -SkipComputerUse -HermesHome $env:MMX_HERMES_HOME '
      + '-InstallDir $env:MMX_HERMES_INSTALL_DIR }';
    const script = "$ErrorActionPreference = 'Stop'; "
      + POWERSHELL_PROXY_SETUP
      + "$hermesHome = if ($env:HERMES_HOME) { $env:HERMES_HOME } "
      + "else { Join-Path $env:USERPROFILE '.hermes' }; "
      + "$installDir = Join-Path $hermesHome 'hermes-agent'; "
      + "$installer = Join-Path ([IO.Path]::GetTempPath()) "
      + "('hermes-install-{0}.ps1' -f [guid]::NewGuid()); "
      + `Invoke-WebRequest -UseBasicParsing -Uri '${url}' -OutFile $installer; `
      + `try { foreach ($stage in @(${stages})) { `
      + '$env:MMX_HERMES_INSTALLER = $installer; $env:MMX_HERMES_STAGE = $stage; '
      + '$env:MMX_HERMES_HOME = $hermesHome; $env:MMX_HERMES_INSTALL_DIR = $installDir; '
      + '& powershell.exe -NoProfile -ExecutionPolicy Bypass '
      + `-Command '${childCommand}'; `
      + '$code = $LASTEXITCODE; if ($code -ne 0) { '
      + 'throw "Hermes installer stage $stage failed with exit code $code." } } } '
      + 'finally { Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue }';
    return {
      executable: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      display: script,
    };
  }

  const url = INSTALLER_URLS[agent];
  if (agent === 'hermes') {
    const stages = HERMES_POSIX_STAGES.join(' ');
    const script = 'set -e; installer=$(mktemp); trap \'rm -f "$installer"\' EXIT; '
      + `curl -fsSL ${url} -o "$installer"; `
      + `for stage in ${stages}; do `
      + 'bash "$installer" --stage "$stage" --non-interactive; done';
    return {
      executable: 'bash',
      args: ['-c', script],
      display: script,
    };
  }

  const display = `curl -fsSL ${url} | bash`;
  return {
    executable: 'bash',
    args: ['-c', `set -o pipefail; ${display}`],
    display,
  };
}

export function getAgentInstallCommand(
  agent: AgentId,
  platform: NodeJS.Platform = process.platform,
): AgentInstallCommand {
  if (agent === 'claude-code' || agent === 'grok' || agent === 'hermes') {
    return getScriptInstallCommand(agent, platform);
  }

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
  agent: AgentId,
  platform: NodeJS.Platform = process.platform,
): AgentInstallCommand {
  if (agent === 'claude-code' || agent === 'grok' || agent === 'hermes') {
    const executable = agent === 'claude-code' ? 'claude' : agent;
    const display = `${executable} --version`;
    if (platform === 'win32') {
      const fallback = agent === 'claude-code'
        ? "& (Join-Path $env:USERPROFILE '.local\\bin\\claude.exe') --version"
        : agent === 'grok'
          ? "$bin = if ($env:GROK_BIN_DIR) { $env:GROK_BIN_DIR } else { Join-Path $env:USERPROFILE '.grok\\bin' }; & (Join-Path $bin 'grok.exe') --version"
          : "$home = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:USERPROFILE '.hermes' }; $exe = Join-Path $home 'bin\\hermes.exe'; $cmd = Join-Path $home 'bin\\hermes.cmd'; if (Test-Path $exe) { & $exe --version } elseif (Test-Path $cmd) { & $cmd --version } else { exit 127 }";
      return {
        executable: 'powershell.exe',
        args: ['-NoProfile', '-Command', fallback],
        display,
      };
    }
    const fallback = agent === 'claude-code'
      ? 'command -v claude >/dev/null 2>&1 && exec claude --version; '
        + 'exec "$HOME/.local/bin/claude" --version'
      : agent === 'grok'
        ? 'command -v grok >/dev/null 2>&1 && exec grok --version; exec "${GROK_BIN_DIR:-$HOME/.grok/bin}/grok" --version'
        : 'command -v hermes >/dev/null 2>&1 && exec hermes --version; '
          + 'for bin in "$HOME/.local/bin/hermes" /usr/local/bin/hermes "${PREFIX:+$PREFIX/bin/hermes}"; '
          + 'do [ -n "$bin" ] && [ -x "$bin" ] && exec "$bin" --version; done; exit 127';
    return {
      executable: 'bash',
      args: ['-c', fallback],
      display,
    };
  }

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

function installerEnvironment(proxy: string | undefined): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const hasEnvironmentProxy = PROXY_ENV_KEYS.some(key => Boolean(env[key]?.trim()));
  if (proxy && !hasEnvironmentProxy) {
    env.HTTPS_PROXY = proxy;
    env.https_proxy = proxy;
    env.HTTP_PROXY = proxy;
    env.http_proxy = proxy;
  }
  return env;
}

function childIsRunning(child: ChildProcess): boolean {
  return child.pid !== undefined && child.exitCode === null && child.signalCode === null;
}

function terminateProcessTree(child: ChildProcess, force = false): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    const result = spawnSync(
      'taskkill.exe',
      ['/pid', String(child.pid), '/t', '/f'],
      { stdio: 'ignore', windowsHide: true, timeout: 5_000 },
    );
    if (result.status === 0) return;
  } else {
    try {
      process.kill(-child.pid!, force ? 'SIGKILL' : 'SIGTERM');
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
    }
  }

  if (childIsRunning(child)) {
    try {
      child.kill(force ? 'SIGKILL' : 'SIGTERM');
    } catch {
      // The process exited between the running check and the signal.
    }
  }
}

async function runAgentInstallCommand(
  command: AgentInstallCommand,
  options: AgentInstallRunOptions,
): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command.executable, command.args, {
      detached: process.platform !== 'win32',
      env: installerEnvironment(options.proxy),
      stdio: ['inherit', process.stderr, 'inherit'],
    });
    let settled = false;
    const signals = ['SIGHUP', 'SIGINT', 'SIGTERM'] as const;
    const signalHandlers = new Map<NodeJS.Signals, () => void>();
    const removeSignalHandlers = () => {
      for (const [signal, handler] of signalHandlers) {
        process.removeListener(signal, handler);
      }
    };
    const onSignal = (signal: NodeJS.Signals) => {
      removeSignalHandlers();
      terminateProcessTree(child, true);
      if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
    };
    for (const signal of signals) {
      const handler = () => onSignal(signal);
      signalHandlers.set(signal, handler);
      process.prependOnceListener(signal, handler);
    }

    const timeout = setTimeout(() => {
      if (settled) return;
      terminateProcessTree(child, true);
      child.unref();
      settled = true;
      removeSignalHandlers();
      reject(new AgentInstallTimeoutError(options.timeoutMs));
    }, options.timeoutMs);
    timeout.unref();

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      removeSignalHandlers();
      callback();
    };
    child.once('error', error => finish(() => reject(error)));
    child.once('exit', code => finish(() => resolvePromise(code ?? 1)));
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
  const command = getAgentInstallCommand(agent, options.platform);
  const verificationCommand = getAgentVerificationCommand(agent, options.platform);
  const networkHint = 'Check internet access, DNS, firewall, and proxy settings, then retry.';
  const manualHint = agent === 'claude-code' || agent === 'grok' || agent === 'hermes'
    ? `Run the official installer manually:\n${command.display}`
    : `Run the installer manually:\n${command.display}\nFor npm permission errors, see: `
      + 'https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally';
  const hint = `${networkHint}\n${manualHint}`;
  const installRunner = options.runner
    ?? ((candidate: AgentInstallCommand) => runAgentInstallCommand(candidate, {
      proxy: options.proxy,
      timeoutMs: options.installTimeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS,
    }));

  let exitCode: number;
  try {
    exitCode = await installRunner(command);
  } catch (error) {
    if (error instanceof AgentInstallTimeoutError) {
      throw new CLIError(
        `Installation for ${agent} timed out after ${Math.ceil(error.timeoutMs / 1000)} seconds.`,
        ExitCode.TIMEOUT,
        `The installer was stopped. ${hint}`,
      );
    }
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

  const verificationRunner = options.runner
    ?? ((candidate: AgentInstallCommand) => runAgentInstallCommand(candidate, {
      proxy: options.proxy,
      timeoutMs: VERIFICATION_TIMEOUT_MS,
    }));
  let verificationExitCode: number;
  try {
    verificationExitCode = await verificationRunner(verificationCommand);
  } catch (error) {
    if (error instanceof AgentInstallTimeoutError) {
      throw new CLIError(
        `Installed ${agent}, but ${verificationCommand.display} timed out after `
          + `${Math.ceil(error.timeoutMs / 1000)} seconds.`,
        ExitCode.TIMEOUT,
        `Open a new terminal and verify the installation manually:\n${verificationCommand.display}`,
      );
    }
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
