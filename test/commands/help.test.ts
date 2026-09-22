import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('mmx help', () => {
  let home: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mmx-help-'));
    originalHome = process.env.HOME;
    process.env.HOME = home;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('prints documentation links without requiring credentials', async () => {
    const child = Bun.spawn({
      cmd: [process.execPath, 'run', 'src/main.ts', 'help'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: home,
        MMX_CONFIG_DIR: join(home, '.mmx'),
        NO_COLOR: '1',
        MINIMAX_API_KEY: '',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain('MiniMax API Documentation Links');
    expect(stderr).not.toContain('No credentials found');
    expect(stderr).not.toContain('How would you like to authenticate');
  });
});
