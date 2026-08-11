import { describe, it, expect } from 'bun:test';
import {
  DEFAULT_TEXT_MODEL,
  TEXT_MODELS,
} from '../../../src/commands/text/models';

describe('text models', () => {
  it('registers supported models in default order', () => {
    expect(TEXT_MODELS).toEqual(['MiniMax-M3', 'MiniMax-M2.7']);
    expect(DEFAULT_TEXT_MODEL).toBe('MiniMax-M3');
  });
});
