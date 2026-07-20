import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTextFromPathOrStdin, resolveTextInput } from '../../src/utils/fs';

describe('readTextFromPathOrStdin', () => {
  it('uses file descriptor zero for the stdin marker on every platform', () => {
    expect(resolveTextInput('-')).toBe(0);
  });

  it('keeps ordinary file paths unchanged and reads their text', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mmx-fs-test-'));
    const path = join(dir, 'input.txt');
    writeFileSync(path, 'hello from a file', 'utf-8');

    try {
      expect(resolveTextInput(path)).toBe(path);
      expect(readTextFromPathOrStdin(path)).toBe('hello from a file');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
