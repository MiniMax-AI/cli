import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { tmpdir } from 'os';
import { join } from 'path';

// We replace fs.renameSync so we can simulate EXDEV (cross-device link
// not permitted). The factory uses `require` to reach the real fs module
// (mock.module only intercepts ESM imports, not CommonJS require), and
// captures the real renameSync so the test can still call it when
// exercising the happy path.
//
// mock.module is hoisted by Bun above all other imports, so by the time
// src/config/loader.ts is imported below, the loader sees the mocked
// renameSync.

let realRenameSync: typeof import('fs').renameSync;

const renameMock = mock((src: string, dst: string) => {
  return realRenameSync(src, dst);
});

mock.module('fs', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const realFs = require('fs') as typeof import('fs');
  realRenameSync = realFs.renameSync;
  return {
    ...realFs,
    renameSync: renameMock,
  };
});

// At this point `fs` is the mocked module (the real fs is captured in
// the mock factory's closure). The mock spreads the real fs, so all
// non-renameSync functions are the real ones and work as expected in
// the test body.
import * as fs from 'fs';

import { writeConfigFile } from '../../src/config/loader';

function makeExdevError(): NodeJS.ErrnoException {
  const err = new Error('EXDEV: cross-device link not permitted') as NodeJS.ErrnoException;
  err.code = 'EXDEV';
  err.errno = -18;
  return err;
}

describe('writeConfigFile EXDEV fallback', () => {
  let testDir: string;
  let originalHome: string | undefined;
  let originalRegion: string | undefined;
  let originalConfigDir: string | undefined;
  let configPath: string;
  let tmpPath: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'mmx-exdev-'));
    originalHome = process.env.HOME;
    originalRegion = process.env.MINIMAX_REGION;
    originalConfigDir = process.env.MMX_CONFIG_DIR;
    const mmxDir = join(testDir, '.mmx');
    process.env.HOME = testDir;
    process.env.MMX_CONFIG_DIR = mmxDir;
    delete process.env.MINIMAX_REGION;
    configPath = join(mmxDir, 'config.json');
    tmpPath = configPath + '.tmp';
    // Reset mock to a pass-through for each test.
    renameMock.mockImplementation((src: string, dst: string) => realRenameSync(src, dst));
  });

  afterEach(() => {
    // Reset the mock to pass-through so it doesn't leak its last-set
    // implementation (e.g. throwing EACCES) into other test files that
    // share this Bun process and import fs.
    renameMock.mockImplementation((src: string, dst: string) => realRenameSync(src, dst));
    process.env.HOME = originalHome;
    if (originalRegion === undefined) delete process.env.MINIMAX_REGION;
    else process.env.MINIMAX_REGION = originalRegion;
    if (originalConfigDir === undefined) delete process.env.MMX_CONFIG_DIR;
    else process.env.MMX_CONFIG_DIR = originalConfigDir;
    if (testDir) fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('falls back to copy+unlink when rename throws EXDEV', async () => {
    // Simulate the temp file living on a different mount than the config dir.
    renameMock.mockImplementation(() => {
      throw makeExdevError();
    });

    await writeConfigFile({ foo: 'bar' });

    // The destination file should exist with the expected contents.
    expect(fs.existsSync(configPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(written).toEqual({ foo: 'bar' });

    // The .tmp file should have been cleaned up.
    expect(fs.existsSync(tmpPath)).toBe(false);
  });

  it('uses rename normally when EXDEV is not thrown (happy path)', async () => {
    // Default pass-through mock is in effect from beforeEach.
    await writeConfigFile({ hello: 'world' });

    expect(fs.existsSync(configPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(written).toEqual({ hello: 'world' });
    expect(fs.existsSync(tmpPath)).toBe(false);
  });

  it('propagates non-EXDEV errors from rename', async () => {
    renameMock.mockImplementation(() => {
      const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    });

    await expect(writeConfigFile({ a: 1 })).rejects.toThrow('EACCES');
  });
});
