import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadConfig } from '../../src/config/loader';
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
