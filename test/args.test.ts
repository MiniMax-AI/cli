import { describe, it, expect } from 'bun:test';
import { parseFlags } from '../src/args';
import type { OptionDef } from '../src/command';

const OPTIONS: OptionDef[] = [
  { flag: '--timeout <seconds>', description: 'Request timeout', type: 'number' },
  { flag: '--message <text>', description: 'Message text', type: 'array' },
  { flag: '--verbose', description: 'Verbose output' },
];

describe('parseFlags', () => {
  it('rejects non-numeric values for number flags', () => {
    expect(() => parseFlags(['--timeout', 'abc'], OPTIONS)).toThrow(
      'Flag --timeout requires a numeric value, got "abc".',
    );
  });

  it('rejects empty values for number flags', () => {
    expect(() => parseFlags(['--timeout='], OPTIONS)).toThrow(
      'Flag --timeout requires a numeric value, got "".',
    );
  });

  it('still accepts finite numeric values', () => {
    const flags = parseFlags(['--timeout', '1.5'], OPTIONS);

    expect(flags.timeout).toBe(1.5);
  });

  it('treats a bare boolean flag as true', () => {
    expect(parseFlags(['--verbose'], OPTIONS).verbose).toBe(true);
  });

  it('honours explicit false-like values on a boolean flag', () => {
    // Regression: `--flag=false` / `--flag=0` were silently set to true.
    for (const v of ['false', '0', 'no', 'off', ' OFF ', 'False']) {
      expect(parseFlags([`--verbose=${v}`], OPTIONS).verbose).toBe(false);
    }
  });

  it('honours explicit true-like values on a boolean flag', () => {
    for (const v of ['true', '1', 'yes', 'on', 'TRUE']) {
      expect(parseFlags([`--verbose=${v}`], OPTIONS).verbose).toBe(true);
    }
  });

  it('rejects an unrecognised explicit boolean value', () => {
    expect(() => parseFlags(['--verbose=maybe'], OPTIONS)).toThrow(
      'Flag --verbose requires a boolean value',
    );
    expect(() => parseFlags(['--verbose='], OPTIONS)).toThrow(
      'Flag --verbose requires a boolean value',
    );
  });
});
