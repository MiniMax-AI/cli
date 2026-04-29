import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawn, spawnSync } from 'child_process';

function runCli(args: string[], home: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    CI: '1',
    NO_COLOR: '1',
  };
  delete env.MINIMAX_API_KEY;

  return spawnSync(process.execPath, ['src/main.ts', ...args], {
    cwd: process.cwd(),
    env,
    encoding: 'utf-8',
  });
}

function runCliAsync(args: string[], home: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    CI: '1',
    NO_COLOR: '1',
  };
  delete env.MINIMAX_API_KEY;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/main.ts', ...args], {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('CLI process timed out'));
    }, 5000);

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

describe('main CLI auth setup', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mmx-main-test-'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('allows dry-run commands without configured credentials', () => {
    const result = runCli(
      ['text', 'chat', '--message', 'hello', '--dry-run', '--output', 'json'],
      home,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"request"');
    expect(result.stdout).toContain('"hello"');
    expect(result.stderr).not.toContain('No API key found');
  });

  it('lets auth status report unauthenticated state without prompting for setup', () => {
    const result = runCli(['auth', 'status', '--output', 'json'], home);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"authenticated": false');
    expect(result.stdout).toContain('Not authenticated');
    expect(result.stderr).not.toContain('No API key found');
  });

  it('allows OAuth credentials to satisfy auth setup for API commands', async () => {
    mkdirSync(join(home, '.mmx'), { recursive: true });
    writeFileSync(
      join(home, '.mmx', 'credentials.json'),
      JSON.stringify({
        access_token: 'oauth-access-token',
        refresh_token: 'oauth-refresh-token',
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        token_type: 'Bearer',
      }),
      { mode: 0o600 },
    );

    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'ok' }],
          model: 'MiniMax-M2.7',
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      },
    });

    try {
      const result = await runCliAsync(
        [
          'text',
          'chat',
          '--message',
          'hello',
          '--base-url',
          `http://127.0.0.1:${server.port}`,
          '--output',
          'json',
        ],
        home,
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('"id": "msg_1"');
      expect(result.stderr).not.toContain('No API key found');
    } finally {
      server.stop(true);
    }
  });
});
