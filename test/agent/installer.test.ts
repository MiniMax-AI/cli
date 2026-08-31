import { describe, expect, it } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
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
  it('uses the official npm packages without invoking an agent', () => {
    expect(getAgentInstallCommand('claude-code', 'linux')).toEqual({
      executable: 'npm',
      args: ['install', '-g', '@anthropic-ai/claude-code@latest'],
      display: 'npm install -g @anthropic-ai/claude-code@latest',
    });
    expect(() => getAgentInstallCommand('grok', 'linux'))
      .toThrow('grok has no configuration-safe automated installer');
    expect(() => getAgentInstallCommand('hermes', 'linux'))
      .toThrow('hermes has no configuration-safe automated installer');
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
  });

  it('verifies the installed executable without launching the agent', () => {
    expect(getAgentVerificationCommand('claude-code', 'linux')).toEqual({
      executable: 'claude',
      args: ['--version'],
      display: 'claude --version',
    });
    expect(getAgentVerificationCommand('pi', 'win32')).toEqual({
      executable: 'cmd.exe',
      args: ['/d', '/s', '/c', 'pi --version'],
      display: 'pi --version',
    });
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
    })).toContain('npm');
    expect(getAgentInstallIssue('codex', {
      commandExists: () => false,
    })).toContain('npm');
    expect(getAgentInstallIssue('hermes', commandsExist)).toContain('changes shell configuration');
    expect(getAgentInstallIssue('grok', commandsExist)).toContain('changes Grok configuration');
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
});
