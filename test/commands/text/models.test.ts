import { describe, it, expect } from 'bun:test';
import {
  TEXT_MODELS,
  DEFAULT_TEXT_MODEL,
  textModel,
  isTextModel,
} from '../../../src/commands/text/models';
import type { Config } from '../../../src/config/schema';

const baseConfig: Config = {
  region: 'global',
  baseUrl: 'https://api.minimax.io',
  output: 'text',
  timeout: 300,
  verbose: false,
  quiet: false,
  noColor: true,
  yes: false,
  dryRun: false,
  nonInteractive: true,
  async: false,
};

describe('text model registry', () => {
  it('registers the current MiniMax text models', () => {
    expect(TEXT_MODELS).toContain('MiniMax-M3');
    expect(TEXT_MODELS).toContain('MiniMax-M2.7');
    expect(DEFAULT_TEXT_MODEL).toBe('MiniMax-M3');
  });

  it('uses the explicit flag when provided', () => {
    expect(textModel(baseConfig, 'MiniMax-M2.7')).toBe('MiniMax-M2.7');
  });

  it('falls back to a registered config default', () => {
    const cfg: Config = { ...baseConfig, defaultTextModel: 'MiniMax-M2.7' };
    expect(textModel(cfg, undefined)).toBe('MiniMax-M2.7');
  });

  it('ignores an unregistered config default', () => {
    const cfg: Config = { ...baseConfig, defaultTextModel: 'some-other-model' };
    expect(textModel(cfg, undefined)).toBe(DEFAULT_TEXT_MODEL);
  });

  it('falls back to the built-in default when nothing is set', () => {
    expect(textModel(baseConfig, undefined)).toBe(DEFAULT_TEXT_MODEL);
  });

  it('isTextModel recognizes registered ids only', () => {
    expect(isTextModel('MiniMax-M3')).toBe(true);
    expect(isTextModel('MiniMax-M2.7')).toBe(true);
    expect(isTextModel('not-a-model')).toBe(false);
  });
});
