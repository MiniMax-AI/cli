import { afterEach, describe, expect, it } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { detectAgentsOnPath } from '../../src/agent/availability';

describe('agent availability', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('detects supported executable names without treating directories as commands', () => {
    const root = mkdtempSync(join(tmpdir(), 'mmx-agent-path-'));
    roots.push(root);
    const suffix = process.platform === 'win32' ? '.CMD' : '';
    const executable = join(root, `pi${suffix}`);
    writeFileSync(executable, '');
    chmodSync(executable, 0o700);
    mkdirSync(join(root, `codex${suffix}`));

    const detected = detectAgentsOnPath({
      PATH: root,
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
    });

    expect(detected).toEqual(new Set(['pi']));
  });

  it('recognizes every supported Grok executable name', () => {
    const suffix = process.platform === 'win32' ? '.CMD' : '';
    for (const command of ['grok', 'grok-build', 'grok-cli']) {
      const root = mkdtempSync(join(tmpdir(), 'mmx-agent-path-'));
      roots.push(root);
      const executable = join(root, `${command}${suffix}`);
      writeFileSync(executable, '');
      chmodSync(executable, 0o700);

      expect(detectAgentsOnPath({ PATH: root, PATHEXT: '.COM;.EXE;.BAT;.CMD' }).has('grok'))
        .toBe(true);
    }
  });

  it('does not scan the working directory when PATH is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'mmx-agent-path-'));
    roots.push(root);
    const originalCwd = process.cwd();
    const suffix = process.platform === 'win32' ? '.CMD' : '';
    const executable = join(root, `codex${suffix}`);
    writeFileSync(executable, '');
    chmodSync(executable, 0o700);
    process.chdir(root);
    try {
      expect(detectAgentsOnPath({})).toEqual(new Set());
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('does not treat Path as PATH on case-sensitive platforms', () => {
    if (process.platform === 'win32') return;
    const root = mkdtempSync(join(tmpdir(), 'mmx-agent-path-'));
    roots.push(root);
    const executable = join(root, 'pi');
    writeFileSync(executable, '');
    chmodSync(executable, 0o700);

    expect(detectAgentsOnPath({ Path: root })).toEqual(new Set());
  });
});
