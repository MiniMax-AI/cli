import { afterEach, describe, expect, it } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { detectAgentsOnPath, detectAvailableAgents } from '../../src/agent/availability';

describe('agent availability', () => {
  const roots: string[] = [];

  function executableDirectory(command: string): string {
    const root = mkdtempSync(join(tmpdir(), 'mmx-agent-path-'));
    roots.push(root);
    const suffix = process.platform === 'win32' ? '.CMD' : '';
    const executable = join(root, `${command}${suffix}`);
    writeFileSync(executable, '');
    chmodSync(executable, 0o700);
    return root;
  }

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('detects supported executable names without treating directories as commands', () => {
    const root = executableDirectory('pi');
    const suffix = process.platform === 'win32' ? '.CMD' : '';
    mkdirSync(join(root, `codex${suffix}`));

    const detected = detectAgentsOnPath({
      PATH: root,
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
    });

    expect(detected).toEqual(new Set(['pi']));
  });

  it('recognizes every supported Grok executable name', () => {
    for (const command of ['grok', 'grok-build', 'grok-cli']) {
      const root = executableDirectory(command);
      expect(detectAgentsOnPath({ PATH: root, PATHEXT: '.COM;.EXE;.BAT;.CMD' }).has('grok'))
        .toBe(true);
    }
  });

  it('does not scan the working directory when PATH is missing', () => {
    const root = executableDirectory('codex');
    const originalCwd = process.cwd();
    process.chdir(root);
    try {
      expect(detectAgentsOnPath({})).toEqual(new Set());
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('does not treat Path as PATH on case-sensitive platforms', () => {
    if (process.platform === 'win32') return;
    const root = executableDirectory('pi');

    expect(detectAgentsOnPath({ Path: root })).toEqual(new Set());
  });

  it('recognizes the active Codex runtime without a Codex executable on PATH', () => {
    expect(detectAvailableAgents({ CODEX_THREAD_ID: 'thread-id' })).toEqual(new Set(['codex']));
  });

  it('keeps PATH detection when recognizing the active Codex runtime', () => {
    const root = executableDirectory('pi');
    expect(detectAvailableAgents({
      PATH: root,
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
      CODEX_THREAD_ID: 'thread-id',
    })).toEqual(new Set(['codex', 'pi']));
  });

  it('does not recognize a Codex runtime when its marker is missing', () => {
    expect(detectAvailableAgents({})).toEqual(new Set());
  });

  it('ignores empty and whitespace-only Codex runtime markers', () => {
    expect(detectAvailableAgents({ CODEX_THREAD_ID: '' })).toEqual(new Set());
    expect(detectAvailableAgents({ CODEX_THREAD_ID: '  ' })).toEqual(new Set());
  });
});
