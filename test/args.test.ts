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

  it('honours an explicit value on a boolean flag instead of forcing true', () => {
    // Regression: `--flag=false` / `--flag=0` were silently set to true.
    expect(parseFlags(['--verbose=false'], OPTIONS).verbose).toBe(false);
    expect(parseFlags(['--verbose=0'], OPTIONS).verbose).toBe(false);
    expect(parseFlags(['--verbose=true'], OPTIONS).verbose).toBe(true);
  });
});
