import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { CLI_VERSION } from '../src/version';

const packageVersion = (JSON.parse(readFileSync('package.json', 'utf-8')) as { version: string }).version;
const DEVELOPMENT_VERSION = '0.0.0-dev';

describe('CLI version', () => {
  it('uses the development package version when no build override is present', () => {
    expect(packageVersion).toBe(DEVELOPMENT_VERSION);
    expect(CLI_VERSION).toBe(DEVELOPMENT_VERSION);
  });

  it('prints the development package version in dev mode', () => {
    const result = spawnSync(process.execPath, ['src/main.ts', '--version'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(`mmx ${DEVELOPMENT_VERSION}`);
  });
});
