import { describe, expect, it } from 'bun:test';

import { passwordMaskPreview } from '../../src/utils/prompt';

describe('passwordMaskPreview', () => {
  it('caps long input while keeping visible typing progress', () => {
    expect(passwordMaskPreview(5)).toBe('•••••');
    expect(passwordMaskPreview(160)).toBe('••••••••••••… (160 chars)');
    expect(passwordMaskPreview(160)).not.toContain('\n');
  });
});
