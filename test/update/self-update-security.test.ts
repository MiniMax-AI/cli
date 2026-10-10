import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { downloadFile } from '../../src/update/self-update';

const originalFetch = globalThis.fetch;
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mmx-update-sec-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const dir of tempDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('self-update security: safe write semantics and symlink resistance', () => {
  it('refuses to overwrite an existing file or symlink using flags: wx', async () => {
    const dir = makeTempDir();
    const dest = join(dir, 'mmx-update-target');

    // Pre-create target (simulating attacker planting a symlink or file)
    writeFileSync(dest, 'ORIGINAL_FILE_CONTENT');

    globalThis.fetch = (async () => new Response('ATTACKER_PAYLOAD', {
      status: 200,
      headers: { 'content-length': '16' },
    })) as unknown as typeof fetch;

    // Must reject because file already exists (flags: wx)
    await expect(downloadFile('https://example.com/binary', dest)).rejects.toThrow();

    // Original file content must be intact and not overwritten
    expect(readFileSync(dest, 'utf-8')).toBe('ORIGINAL_FILE_CONTENT');
  });
});
