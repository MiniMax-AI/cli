import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeConfigFile } from '../../src/config/loader';

describe('writeConfigFile security (unpredictable temp file and symlink resistance)', () => {
  const testDir = join(tmpdir(), `mmx-config-sec-test-${Date.now()}`);
  const originalConfigDir = process.env.MMX_CONFIG_DIR;

  beforeEach(() => {
    process.env.MMX_CONFIG_DIR = testDir;
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (originalConfigDir === undefined) delete process.env.MMX_CONFIG_DIR;
    else process.env.MMX_CONFIG_DIR = originalConfigDir;
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('does not write to a predictable config.json.tmp path', async () => {
    const decoyTmp = join(testDir, 'config.json.tmp');
    writeFileSync(decoyTmp, 'DECOY_CONTENT_SHOULD_NOT_BE_TOUCHED');

    await writeConfigFile({ region: 'cn', output: 'json' });

    const finalConfig = join(testDir, 'config.json');
    expect(existsSync(finalConfig)).toBe(true);
    expect(JSON.parse(readFileSync(finalConfig, 'utf-8')).region).toBe('cn');

    // The decoy config.json.tmp was NOT overwritten
    expect(readFileSync(decoyTmp, 'utf-8')).toBe('DECOY_CONTENT_SHOULD_NOT_BE_TOUCHED');
  });

  it('cleans up temporary files if rename throws an error', async () => {
    const failingRename = {
      rename: () => {
        const err = new Error('Disk full');
        throw err;
      },
      copy: () => {},
      unlink: () => {},
    };

    await expect(writeConfigFile({ test: 'fail' }, failingRename)).rejects.toThrow('Disk full');

    // No leftover temporary files in testDir
    const files = (await import('fs')).readdirSync(testDir);
    const leftoverTmps = files.filter(f => f.endsWith('.tmp'));
    expect(leftoverTmps).toEqual([]);
  });
});
