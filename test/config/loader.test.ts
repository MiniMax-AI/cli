import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { copyFileSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadConfig, renameWithCrossDeviceFallback, writeConfigFile } from '../../src/config/loader';
import { CLIError } from '../../src/errors/base';
import type { GlobalFlags } from '../../src/types/flags';

const baseFlags: GlobalFlags = {
  quiet: false,
  verbose: false,
  noColor: true,
  yes: false,
  dryRun: false,
  help: false,
  nonInteractive: true,
  async: false,
};

describe('loadConfig', () => {
  const testDir = join(tmpdir(), `mmx-config-test-${Date.now()}`);
  const originalHome = process.env.HOME;
  const originalRegion = process.env.MINIMAX_REGION;

  beforeEach(() => {
    mkdirSync(join(testDir, '.mmx'), { recursive: true });
    process.env.HOME = testDir;
    delete process.env.MINIMAX_REGION;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    if (originalRegion === undefined) delete process.env.MINIMAX_REGION;
    else process.env.MINIMAX_REGION = originalRegion;
    rmSync(testDir, { recursive: true, force: true });
  });

  it('rejects invalid --region values', () => {
    expect(() => loadConfig({ ...baseFlags, region: 'mars' })).toThrow(CLIError);
    expect(() => loadConfig({ ...baseFlags, region: 'mars' })).toThrow(
      'Invalid region "mars". Valid values: global, cn',
    );
  });

  it('rejects invalid MINIMAX_REGION values', () => {
    process.env.MINIMAX_REGION = 'moon';

    expect(() => loadConfig(baseFlags)).toThrow(
      'Invalid region "moon". Valid values: global, cn',
    );
  });

  it('accepts valid explicit region values', () => {
    const config = loadConfig({ ...baseFlags, region: 'cn' });

    expect(config.region).toBe('cn');
    expect(config.baseUrl).toBe('https://api.minimaxi.com');
  });
});

describe('writeConfigFile', () => {
  const testDir = join(tmpdir(), `mmx-config-write-test-${Date.now()}`);
  const originalConfigDir = process.env.MMX_CONFIG_DIR;

  beforeEach(() => {
    process.env.MMX_CONFIG_DIR = testDir;
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (originalConfigDir === undefined) delete process.env.MMX_CONFIG_DIR;
    else process.env.MMX_CONFIG_DIR = originalConfigDir;
    rmSync(testDir, { recursive: true, force: true });
    mock.restore();
  });

  it('falls back to copy and unlink when rename crosses devices', async () => {
    const calls: string[] = [];
    const renameMock = mock((from: string, _to: string) => {
      calls.push(`rename:${from}`);
      const err = new Error('cross-device link not permitted') as NodeJS.ErrnoException;
      err.code = 'EXDEV';
      err.path = from;
      throw err;
    });
    const copyMock = mock((from: string, _to: string) => {
      calls.push(`copy:${from}`);
    });
    const unlinkMock = mock((path: string) => {
      calls.push(`unlink:${path}`);
    });

    renameWithCrossDeviceFallback('config.json.tmp', 'config.json', {
      rename: renameMock,
      copy: copyMock,
      unlink: unlinkMock,
    });

    expect(renameMock).toHaveBeenCalledTimes(1);
    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(unlinkMock).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      'rename:config.json.tmp',
      'copy:config.json.tmp',
      'unlink:config.json.tmp',
    ]);
  });

  it('writes the config file when the final rename crosses devices', async () => {
    const renameMock = mock((from: string, _to: string) => {
      const err = new Error('cross-device link not permitted') as Error & {
        code?: string;
        path?: string;
      };
      err.code = 'EXDEV';
      err.path = from;
      throw err;
    });
    const copyMock = mock((from: string, to: string) => copyFileSync(from, to));
    const unlinkMock = mock((path: string) => unlinkSync(path));

    await writeConfigFile({ region: 'cn', output: 'json' }, {
      rename: renameMock,
      copy: copyMock,
      unlink: unlinkMock,
    });

    const configPath = join(testDir, 'config.json');
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8'));

    expect(renameMock).toHaveBeenCalledTimes(1);
    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(unlinkMock).toHaveBeenCalledTimes(1);
    expect(parsed.region).toBe('cn');
    expect(parsed.output).toBe('json');
  });

  it('rethrows non-EXDEV rename errors', () => {
    const renameMock = mock(() => {
      const err = new Error('permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    });

    expect(() => renameWithCrossDeviceFallback('config.json.tmp', 'config.json', {
      rename: renameMock,
      copy: mock(() => {}),
      unlink: mock(() => {}),
    })).toThrow('permission denied');
  });

  it('uses atomic rename on the normal path', async () => {
    await writeConfigFile({ output: 'json' });

    const configPath = join(testDir, 'config.json');
    expect(JSON.parse(readFileSync(configPath, 'utf-8')).output).toBe('json');
  });
});

describe('loadConfig — baseUrl source chain', () => {
  const testDir = join(tmpdir(), `mmx-baseurl-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const configPath = join(testDir, 'config.json');
  const originalConfigDir = process.env.MMX_CONFIG_DIR;

  beforeEach(() => {
    process.env.MMX_CONFIG_DIR = testDir;
    delete process.env.MINIMAX_BASE_URL;
    delete process.env.MINIMAX_REGION;
  });

  afterEach(() => {
    if (originalConfigDir === undefined) delete process.env.MMX_CONFIG_DIR;
    else process.env.MMX_CONFIG_DIR = originalConfigDir;
    rmSync(testDir, { recursive: true, force: true });
  });

  function writeConfig(body: object): void {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify(body));
  }

  it('uses file.base_url when set, with no flag or env', () => {
    writeConfig({ base_url: 'https://api.from-file.example' });
    const cfg = loadConfig(baseFlags);
    expect(cfg.baseUrl).toBe('https://api.from-file.example');
  });

  it('falls back to REGIONS.global when nothing is set', () => {
    writeConfig({});
    const cfg = loadConfig(baseFlags);
    expect(cfg.baseUrl).toBe('https://api.minimax.io');
  });

  it('falls back to REGIONS[region] when region is set in config file', () => {
    writeConfig({ region: 'cn' });
    const cfg = loadConfig(baseFlags);
    expect(cfg.baseUrl).toBe('https://api.minimaxi.com');
  });

  it('ignores MINIMAX_BASE_URL env even when file.base_url is missing', () => {
    writeConfig({});
    process.env.MINIMAX_BASE_URL = 'https://api.from-env.example';
    const cfg = loadConfig(baseFlags);
    expect(cfg.baseUrl).toBe('https://api.minimax.io');
  });

  it('file.base_url wins over MINIMAX_BASE_URL env', () => {
    writeConfig({ base_url: 'https://api.from-file.example' });
    process.env.MINIMAX_BASE_URL = 'https://api.from-env.example';
    const cfg = loadConfig(baseFlags);
    expect(cfg.baseUrl).toBe('https://api.from-file.example');
  });

  it('falls back to REGIONS[region] when region is set via env', () => {
    writeConfig({});
    process.env.MINIMAX_REGION = 'cn';
    const cfg = loadConfig(baseFlags);
    expect(cfg.baseUrl).toBe('https://api.minimaxi.com');
  });

  it('ignores malformed file.base_url (not starting with http) and falls back to regions', () => {
    writeConfig({ base_url: 'not-a-url' });
    const cfg = loadConfig(baseFlags);
    expect(cfg.baseUrl).toBe('https://api.minimax.io');
  });
});
