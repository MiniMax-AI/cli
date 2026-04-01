import { describe, it, expect } from 'bun:test';
import { formatOutput } from '../../src/output/formatter';

describe('formatOutput', () => {
  it('formats JSON output', () => {
    const result = formatOutput({ key: 'value' }, 'json');
    expect(JSON.parse(result)).toEqual({ key: 'value' });
  });

  it('formats text output for objects', () => {
    const result = formatOutput({ name: 'test', status: 'ok' }, 'text');
    expect(result).toContain('name: test');
    expect(result).toContain('status: ok');
  });

  it('formats text output for strings', () => {
    const result = formatOutput('hello world', 'text');
    expect(result).toBe('hello world');
  });

  it('formats text output for arrays of objects as table', () => {
    const result = formatOutput([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
    ], 'text');
    expect(result).toContain('NAME');
    expect(result).toContain('VALUE');
  });

  it('handles null/undefined', () => {
    expect(formatOutput(null, 'text')).toBe('');
    expect(formatOutput(undefined, 'text')).toBe('');
  });

  it('formats nested objects in text mode', () => {
    const result = formatOutput({
      outer: { inner: 'value' },
    }, 'text');
    expect(result).toContain('outer:');
    expect(result).toContain('inner: value');
  });
});
