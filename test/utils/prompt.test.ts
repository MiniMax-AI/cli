import { describe, expect, it } from 'bun:test';

import { apiKeyPreview } from '../../src/utils/prompt';

describe('apiKeyPreview', () => {
  it('shows at most 30 key characters followed by the total length', () => {
    expect(apiKeyPreview('abc')).toBe('abc (3 chars)');
    expect(apiKeyPreview('a'.repeat(30))).toBe(`${'a'.repeat(30)} (30 chars)`);
    expect(apiKeyPreview('a'.repeat(125))).toBe(`${'a'.repeat(30)}.... (125 chars)`);
  });
});
