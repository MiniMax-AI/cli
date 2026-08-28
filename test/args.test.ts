import { describe, it, expect } from 'bun:test';
import { findOptionError, parseFlags, scanCommandPath } from '../src/args';
import { GLOBAL_OPTIONS, type OptionDef } from '../src/command';

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

describe('scanCommandPath', () => {
  it('does not mistake a value after a command-local boolean for a positional', () => {
    const agentOptions: OptionDef[] = [
      { flag: '--all', description: 'All agents' },
    ];

    expect(scanCommandPath(
      ['agent', 'setup', '--all', '--api-key', 'secret', '--region', 'cn'],
      [...GLOBAL_OPTIONS, ...agentOptions],
    )).toEqual(['agent', 'setup']);
  });

  it('reports an unknown option before it can consume a safety flag', () => {
    expect(findOptionError(
      ['agent', 'setup', '--skip-verfiy', '--dry-run'],
      GLOBAL_OPTIONS,
    )).toBe('Unknown option: --skip-verfiy');
  });

  it('rejects a missing value before it can consume a safety flag', () => {
    expect(findOptionError(
      ['agent', 'setup', '--api-key', '--dry-run'],
      GLOBAL_OPTIONS,
    )).toBe('Option --api-key requires a value.');
  });

  it('rejects empty equals-form values', () => {
    for (const option of ['--output=', '--base-url=   ']) {
      expect(findOptionError(['agent', 'setup', option], GLOBAL_OPTIONS))
        .toContain('requires a value');
    }
  });
});
