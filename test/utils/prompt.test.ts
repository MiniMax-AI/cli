import { describe, expect, it } from 'bun:test';

import { apiKeyPreview, textPromptOptions } from '../../src/utils/prompt';

describe('apiKeyPreview', () => {
  it('shows the total length only when the key is truncated', () => {
    expect(apiKeyPreview('abc')).toBe('abc');
    expect(apiKeyPreview('a'.repeat(30))).toBe('a'.repeat(30));
    expect(apiKeyPreview('a'.repeat(125))).toBe(`${'a'.repeat(30)}.... (125 chars)`);
  });
});

describe('textPromptOptions', () => {
  it('keeps the placeholder separate from the editable value', () => {
    expect(textPromptOptions('Enter a value:', 'Ask Mcode')).toEqual({
      message: 'Enter a value:',
      placeholder: 'Ask Mcode',
    });
  });

  it('does not pass a default value as the prompt input', () => {
    expect(textPromptOptions('Enter a value:')).toEqual({
      message: 'Enter a value:',
    });
  });
});
