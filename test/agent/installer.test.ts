import { describe, expect, it } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

import {
  getAgentInstallCommand,
  getAgentInstallIssue,
  getAgentVerificationCommand,
  installAgent,
  type AgentInstallCommand,
} from '../../src/agent/installer';

describe('agent installer', () => {
  it('uses official packages and installer scripts without invoking an agent', () => {
    expect(getAgentInstallCommand('claude-code', 'linux')).toEqual({
      executable: 'bash',
      args: ['-c', 'set -o pipefail; curl -fsSL https://claude.ai/install.sh | bash'],
      display: 'curl -fsSL https://claude.ai/install.sh | bash',
    });
    expect(getAgentInstallCommand('grok', 'linux')).toEqual({
      executable: 'bash',
      args: ['-c', 'set -o pipefail; curl -fsSL https://x.ai/cli/install.sh | bash'],
      display: 'curl -fsSL https://x.ai/cli/install.sh | bash',
    });
    const hermes = getAgentInstallCommand('hermes', 'linux');
    expect(hermes.executable).toBe('bash');
    expect(hermes.args.join(' ')).toContain('https://hermes-agent.nousresearch.com/install.sh');
    expect(hermes.args.join(' ')).toContain('prerequisites');
    expect(hermes.args.join(' ')).toContain('python-deps');
    expect(hermes.args.join(' ')).toContain('node-deps');
    expect(hermes.args.join(' ')).toContain('--non-interactive');
    expect(hermes.args.join(' ')).not.toContain(' setup ');
    expect(hermes.args.join(' ')).not.toContain(' gateway ');
  });

  it('uses each package official installation arguments', () => {
    expect(getAgentInstallCommand('codex', 'linux')).toEqual({
      executable: 'npm',
      args: ['install', '-g', '@openai/codex'],
      display: 'npm install -g @openai/codex',
    });
    expect(getAgentInstallCommand('opencode', 'linux')).toEqual({
      executable: 'npm',
      args: ['install', '-g', 'opencode-ai'],
      display: 'npm install -g opencode-ai',
    });
    expect(getAgentInstallCommand('pi', 'linux')).toEqual({
      executable: 'npm',
      args: ['install', '-g', '--ignore-scripts', '--engine-strict', '@earendil-works/pi-coding-agent'],
      display: 'npm install -g --ignore-scripts --engine-strict @earendil-works/pi-coding-agent',
    });
    expect(getAgentInstallCommand('codex', 'win32')).toEqual({
      executable: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm install -g @openai/codex'],
      display: 'npm install -g @openai/codex',
    });
    const grokWindows = getAgentInstallCommand('grok', 'win32');
    expect(grokWindows.executable).toBe('powershell.exe');
    expect(grokWindows.args.join(' ')).toContain('https://x.ai/cli/install.ps1');
    expect(grokWindows.args.join(' ')).toContain('DefaultWebProxy');
    const claudeWindows = getAgentInstallCommand('claude-code', 'win32');
    expect(claudeWindows.executable).toBe('powershell.exe');
    expect(claudeWindows.args.join(' ')).toContain('https://claude.ai/install.ps1');
    const hermesWindows = getAgentInstallCommand('hermes', 'win32');
    expect(hermesWindows.executable).toBe('powershell.exe');
    expect(hermesWindows.args.join(' ')).toContain("'dependencies'");
    expect(hermesWindows.args.join(' ')).toContain("'system-packages'");
    expect(hermesWindows.args.join(' ')).toContain("'node-deps'");
    expect(hermesWindows.args.join(' ')).toContain("'platform-sdks'");
    expect(hermesWindows.args.join(' ')).toContain('-NonInteractive -SkipComputerUse');
    expect(hermesWindows.args.join(' ')).not.toContain("'configure'");
    expect(hermesWindows.args.join(' ')).not.toContain("'gateway'");
    expect(hermesWindows.args.join(' ').match(/DefaultWebProxy/g)?.length).toBe(2);
  });

  it('verifies the installed executable without launching the agent', () => {
    const claude = getAgentVerificationCommand('claude-code', 'linux');
    expect(claude.executable).toBe('bash');
    expect(claude.args.join(' ')).toContain('$HOME/.local/bin/claude');
    expect(claude.display).toBe('claude --version');
    expect(getAgentVerificationCommand('pi', 'win32')).toEqual({
      executable: 'cmd.exe',
      args: ['/d', '/s', '/c', 'pi --version'],
      display: 'pi --version',
    });
    expect(getAgentVerificationCommand('grok', 'linux').display).toBe('grok --version');
    expect(getAgentVerificationCommand('hermes', 'win32').display).toBe('hermes --version');
  });

  it('preflights platform, architecture, commands, and Node requirements', () => {
    const commandsExist = { commandExists: () => true };
    expect(getAgentInstallIssue('pi', {
      ...commandsExist,
      nodeVersion: '18.20.8',
    })).toContain('Node.js 22.19 or newer');
    expect(getAgentInstallIssue('pi', {
      ...commandsExist,
      nodeVersion: '22.19.0',
    })).toBeUndefined();
    expect(getAgentInstallIssue('codex', {
      ...commandsExist,
      platform: 'freebsd',
    })).toContain('not supported on freebsd');
    expect(getAgentInstallIssue('opencode', {
      ...commandsExist,
      arch: 'riscv64',
    })).toContain('riscv64');
    expect(getAgentInstallIssue('claude-code', {
      commandExists: () => false,
    })).toContain('bash');
    expect(getAgentInstallIssue('claude-code', {
      ...commandsExist,
      nodeVersion: '18.20.8',
    })).toBeUndefined();
    expect(getAgentInstallIssue('codex', {
      commandExists: () => false,
    })).toContain('npm');
    expect(getAgentInstallIssue('hermes', commandsExist)).toBeUndefined();
    expect(getAgentInstallIssue('hermes', {
      ...commandsExist,
      platform: 'darwin',
      arch: 'x64',
    })).toBeUndefined();
    expect(getAgentInstallIssue('hermes', {
      ...commandsExist,
      platform: 'darwin',
      arch: 'arm64',
    })).toBeUndefined();
    expect(getAgentInstallIssue('grok', commandsExist)).toBeUndefined();
    expect(getAgentInstallIssue('grok', {
      platform: 'linux',
      commandExists: executable => executable !== 'curl',
    })).toContain('curl');
    expect(getAgentInstallIssue('hermes', {
      platform: 'linux',
      commandExists: executable => executable !== 'bash',
    })).toContain('bash');
    expect(getAgentInstallIssue('hermes', {
      platform: 'linux',
      commandExists: executable => executable !== 'git',
    })).toContain('git');
  });

  it('does not run an installer that fails preflight', async () => {
    let ran = false;
    await expect(installAgent('pi', {
      nodeVersion: '20.19.0',
      commandExists: () => true,
      runner: async () => {
        ran = true;
        return 0;
      },
    })).rejects.toThrow('Cannot install pi');
    expect(ran).toBe(false);
  });

  it('runs the resolved command and accepts a successful exit', async () => {
    const received: AgentInstallCommand[] = [];
    await installAgent('codex', {
      platform: 'linux',
      commandExists: () => true,
      runner: async (command) => {
        received.push(command);
        return 0;
      },
    });

    expect(received).toEqual([
      getAgentInstallCommand('codex', 'linux'),
      getAgentVerificationCommand('codex', 'linux'),
    ]);
  });

  it('installs and verifies an official script-based agent', async () => {
    const received: AgentInstallCommand[] = [];
    await installAgent('grok', {
      platform: 'linux',
      commandExists: () => true,
      runner: async (command) => {
        received.push(command);
        return 0;
      },
    });

    expect(received).toEqual([
      getAgentInstallCommand('grok', 'linux'),
      getAgentVerificationCommand('grok', 'linux'),
    ]);
  });

  it('reports a failed install with the manual command and npm permission help', async () => {
    try {
      await installAgent('opencode', { commandExists: () => true, runner: async () => 17 });
      throw new Error('Expected installAgent to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const failure = error as Error & { hint?: string };
      expect(failure.message).toContain('installer exited with code 17');
      expect(failure.hint).toContain('npm install -g opencode-ai');
      expect(failure.hint).toContain('resolving-eacces-permissions-errors');
    }
  });

  it('reports when the installer executable cannot be started', async () => {
    await expect(installAgent('codex', {
      commandExists: () => true,
      runner: async () => { throw new Error('command not found'); },
    })).rejects.toThrow('Could not start the installer for codex. command not found');
  });

  it('does not report success when the installed executable fails verification', async () => {
    let call = 0;
    await expect(installAgent('pi', {
      nodeVersion: '22.19.0',
      commandExists: () => true,
      runner: async () => {
        call += 1;
        return call === 1 ? 0 : 9;
      },
    })).rejects.toThrow('pi --version exited with code 9');
  });

  it('keeps installer output off stdout', async () => {
    if (process.platform === 'win32') return;
    const directory = mkdtempSync(join(tmpdir(), 'mmx-installer-output-'));
    try {
      for (const executable of ['npm', 'codex']) {
        const path = join(directory, executable);
        writeFileSync(path, `#!/bin/sh\necho "${executable} output"\n`);
        chmodSync(path, 0o755);
      }
      const moduleUrl = pathToFileURL(join(import.meta.dir, '../../src/agent/installer.ts')).href;
      const child = Bun.spawn({
        cmd: [
          process.execPath,
          '-e',
          `import { installAgent } from ${JSON.stringify(moduleUrl)}; await installAgent('codex');`,
        ],
        env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ''}` },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const stdoutPromise = new Response(child.stdout).text();
      const stderrPromise = new Response(child.stderr).text();
      expect(await child.exited).toBe(0);
      expect(await stdoutPromise).toBe('');
      expect(await stderrPromise).toContain('npm output');
      expect(await stderrPromise).toContain('codex output');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('passes a configured proxy to installers without overriding an environment proxy', async () => {
    if (process.platform === 'win32') return;
    const directory = mkdtempSync(join(tmpdir(), 'mmx-installer-proxy-'));
    const capture = join(directory, 'proxy.txt');
    try {
      const npm = join(directory, 'npm');
      const codex = join(directory, 'codex');
      writeFileSync(
        npm,
        '#!/bin/sh\nprintf "%s\\n%s\\n" "$HTTPS_PROXY" "$HTTP_PROXY" > "$MMX_PROXY_CAPTURE"\n',
      );
      writeFileSync(codex, '#!/bin/sh\nexit 0\n');
      chmodSync(npm, 0o755);
      chmodSync(codex, 0o755);
      const moduleUrl = pathToFileURL(join(import.meta.dir, '../../src/agent/installer.ts')).href;
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: `${directory}:${process.env.PATH ?? ''}`,
        MMX_PROXY_CAPTURE: capture,
      };
      for (const key of [
        'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy',
      ]) delete env[key];
      const child = Bun.spawn({
        cmd: [
          process.execPath,
          '-e',
          `import { installAgent } from ${JSON.stringify(moduleUrl)}; `
            + "await installAgent('codex', { proxy: 'http://config-proxy.example:8080' });",
        ],
        env,
        stdout: 'ignore',
        stderr: 'ignore',
      });
      expect(await child.exited).toBe(0);
      expect(readFileSync(capture, 'utf8')).toBe(
        'http://config-proxy.example:8080\nhttp://config-proxy.example:8080\n',
      );

      env.HTTPS_PROXY = 'http://environment-proxy.example:8080';
      const precedenceChild = Bun.spawn({
        cmd: [
          process.execPath,
          '-e',
          `import { installAgent } from ${JSON.stringify(moduleUrl)}; `
            + "await installAgent('codex', { proxy: 'http://config-proxy.example:8080' });",
        ],
        env,
        stdout: 'ignore',
        stderr: 'ignore',
      });
      expect(await precedenceChild.exited).toBe(0);
      expect(readFileSync(capture, 'utf8').split('\n')[0]).toBe(
        'http://environment-proxy.example:8080',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('times out and terminates the installer process tree', async () => {
    if (process.platform === 'win32') return;
    const directory = mkdtempSync(join(tmpdir(), 'mmx-installer-timeout-'));
    const pidPath = join(directory, 'child.pid');
    try {
      const npm = join(directory, 'npm');
      writeFileSync(
        npm,
        '#!/bin/sh\ntrap \'\' TERM\nsleep 30 &\nprintf "%s" "$!" > "$MMX_CHILD_PID"\nwait\n',
      );
      chmodSync(npm, 0o755);
      const moduleUrl = pathToFileURL(join(import.meta.dir, '../../src/agent/installer.ts')).href;
      const child = Bun.spawn({
        cmd: [
          process.execPath,
          '-e',
          `import { installAgent } from ${JSON.stringify(moduleUrl)}; `
            + "try { await installAgent('codex', { commandExists: () => true, installTimeoutMs: 200 }); process.exit(2); } "
            + 'catch (error) { if (error?.exitCode !== 5 || !error?.hint?.includes('
            + "'installer was stopped')) process.exit(3); }",
        ],
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH ?? ''}`,
          MMX_CHILD_PID: pidPath,
        },
        stdout: 'ignore',
        stderr: 'ignore',
      });
      expect(await child.exited).toBe(0);
      expect(existsSync(pidPath)).toBe(true);
      const descendantPid = Number(readFileSync(pidPath, 'utf8'));
      let running = true;
      for (let attempt = 0; attempt < 100 && running; attempt += 1) {
        try {
          process.kill(descendantPid, 0);
          await Bun.sleep(10);
        } catch {
          running = false;
        }
      }
      expect(running).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('terminates the installer process tree when setup receives an exit signal', async () => {
    if (process.platform === 'win32') return;
    for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM'] as const) {
      const directory = mkdtempSync(join(tmpdir(), `mmx-installer-${signal.toLowerCase()}-`));
      const pidPath = join(directory, 'child.pid');
      try {
        const npm = join(directory, 'npm');
        writeFileSync(
          npm,
          '#!/bin/sh\ntrap \'\' TERM\nsleep 30 &\nprintf "%s" "$!" > "$MMX_CHILD_PID"\nwait\n',
        );
        chmodSync(npm, 0o755);
        const moduleUrl = pathToFileURL(join(import.meta.dir, '../../src/agent/installer.ts')).href;
        const sigintHandler = signal === 'SIGINT'
          ? "process.on('SIGINT', () => process.exit(130)); "
          : '';
        const child = Bun.spawn({
          cmd: [
            process.execPath,
            '-e',
            `import { installAgent } from ${JSON.stringify(moduleUrl)}; `
              + sigintHandler
              + "await installAgent('codex', { commandExists: () => true });",
          ],
          env: {
            ...process.env,
            PATH: `${directory}:${process.env.PATH ?? ''}`,
            MMX_CHILD_PID: pidPath,
          },
          stdout: 'ignore',
          stderr: 'ignore',
        });
        for (let attempt = 0; attempt < 100 && !existsSync(pidPath); attempt += 1) {
          await Bun.sleep(10);
        }
        expect(existsSync(pidPath)).toBe(true);
        child.kill(signal);
        const expectedExitCode = signal === 'SIGHUP' ? 129 : signal === 'SIGINT' ? 130 : 143;
        expect(await child.exited).toBe(expectedExitCode);

        const descendantPid = Number(readFileSync(pidPath, 'utf8'));
        let running = true;
        for (let attempt = 0; attempt < 100 && running; attempt += 1) {
          try {
            process.kill(descendantPid, 0);
            await Bun.sleep(10);
          } catch {
            running = false;
          }
        }
        expect(running).toBe(false);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });
});
