import { describe, expect, it } from 'bun:test';
import { resolveQuotaCounts } from '../../src/utils/quota';

describe('resolveQuotaCounts', () => {
  it('preserves legacy responses where usage_count means remaining', () => {
    expect(resolveQuotaCounts(3, 3, 100)).toEqual({
      used: 0,
      remaining: 3,
      total: 3,
    });
  });

  it('supports newer responses where usage_count means used', () => {
    expect(resolveQuotaCounts(0, 5, 100)).toEqual({
      used: 0,
      remaining: 5,
      total: 5,
    });
  });

  it('preserves legacy semantics when no percentage is available', () => {
    expect(resolveQuotaCounts(4, 10)).toEqual({
      used: 6,
      remaining: 4,
      total: 10,
    });
  });

  it('returns undefined when neither interpretation matches the percentage', () => {
    expect(resolveQuotaCounts(7, 10, 40)).toBeUndefined();
  });

  it('returns undefined for zero-sized or invalid buckets', () => {
    expect(resolveQuotaCounts(0, 0, 99)).toBeUndefined();
    expect(resolveQuotaCounts(6, 5, 0)).toBeUndefined();
  });
});
