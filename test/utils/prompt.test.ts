import { describe, expect, it } from 'bun:test';

import { apiKeyPreview } from '../../src/utils/prompt';

describe('apiKeyPreview', () => {
  it('shows the total length only when the key is truncated', () => {
    expect(apiKeyPreview('abc')).toBe('abc');
    expect(apiKeyPreview('a'.repeat(30))).toBe('a'.repeat(30));
    expect(apiKeyPreview('a'.repeat(125))).toBe(`${'a'.repeat(30)}.... (125 chars)`);
  });
});
