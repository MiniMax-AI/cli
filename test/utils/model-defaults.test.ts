import { describe, it, expect } from 'bun:test';
import type { Config } from '../../src/config/schema';
import {
  resolveMaxTokens,
  resolveThinkingMode,
  resolveTemperature,
  resolveTopPDefault,
  THINKING_MODES,
  TEMPERATURE_MIN,
  TEMPERATURE_MAX,
} from '../../src/utils/model-defaults';

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

/**
 * Helper: resolve model with priority flag > config default > fallback.
 * Each command implements this inline; this mirrors the logic for testing.
 */
function resolveModel(
  configKey: 'defaultTextModel' | 'defaultSpeechModel' | 'defaultVideoModel' | 'defaultMusicModel',
  fallback: string,
  config: Partial<Config>,
  flags: Record<string, unknown>,
): string {
  if (typeof flags.model === 'string' && flags.model.length > 0) return flags.model;
  const cfg = (config as Record<string, unknown>)[configKey] as string | undefined;
  if (cfg) return cfg;
  return fallback;
}

describe('model resolution (flag > config default > fallback)', () => {
  it('uses flag when provided', () => {
    const model = resolveModel('defaultTextModel', 'MiniMax-M3', baseConfig, { model: 'MiniMax-M2.7' });
    expect(model).toBe('MiniMax-M2.7');
  });

  it('falls back to config default when flag is absent', () => {
    const model = resolveModel('defaultTextModel', 'MiniMax-M3', { ...baseConfig, defaultTextModel: 'MiniMax-M3' }, {});
    expect(model).toBe('MiniMax-M3');
  });

  it('falls back to hardcoded when neither flag nor config', () => {
    const model = resolveModel('defaultTextModel', 'MiniMax-M3', baseConfig, {});
    expect(model).toBe('MiniMax-M3');
  });

  it('flag overrides config default', () => {
    const model = resolveModel('defaultSpeechModel', 'speech-2.8-hd', { ...baseConfig, defaultSpeechModel: 'speech-01-hd' }, { model: 'speech-hd' });
    expect(model).toBe('speech-hd');
  });

  it('config default overrides hardcoded', () => {
    const model = resolveModel('defaultVideoModel', 'MiniMax-Hailuo-2.3', { ...baseConfig, defaultVideoModel: 'MiniMax-Hailuo-2.3-6s-768p' }, {});
    expect(model).toBe('MiniMax-Hailuo-2.3-6s-768p');
  });

  it('handles music model default', () => {
    const model = resolveModel('defaultMusicModel', 'music-3.0', { ...baseConfig, defaultMusicModel: 'music-3.0' }, {});
    expect(model).toBe('music-3.0');
  });
});

describe('resolveMaxTokens (model-aware defaults)', () => {
  it('uses 131072 for MiniMax-M3 when flag is absent', () => {
    expect(resolveMaxTokens('MiniMax-M3', undefined)).toBe(131072);
  });

  it('uses 65536 for MiniMax-M2.7 when flag is absent', () => {
    expect(resolveMaxTokens('MiniMax-M2.7', undefined)).toBe(65536);
  });

  it('uses 65536 for MiniMax-M2.5 when flag is absent', () => {
    expect(resolveMaxTokens('MiniMax-M2.5', undefined)).toBe(65536);
  });

  it('uses 65536 for unknown / other models', () => {
    expect(resolveMaxTokens('gpt-9-snowflake', undefined)).toBe(65536);
  });

  it('flag value 100 always overrides M3 default', () => {
    expect(resolveMaxTokens('MiniMax-M3', 100)).toBe(100);
  });

  it('flag value 100 always overrides M2.7 default', () => {
    expect(resolveMaxTokens('MiniMax-M2.7', 100)).toBe(100);
  });

  it('flag value 524288 (M3 documented max) passes through', () => {
    expect(resolveMaxTokens('MiniMax-M3', 524288)).toBe(524288);
  });
});

describe('resolveThinkingMode', () => {
  it('returns undefined for absent / empty input', () => {
    expect(resolveThinkingMode(undefined)).toBeUndefined();
    expect(resolveThinkingMode(null)).toBeUndefined();
    expect(resolveThinkingMode('')).toBeUndefined();
  });

  it('returns the mode for known values', () => {
    expect(resolveThinkingMode('enabled')).toBe('enabled');
    expect(resolveThinkingMode('disabled')).toBe('disabled');
    expect(resolveThinkingMode('adaptive')).toBe('adaptive');
  });

  it('normalizes case', () => {
    expect(resolveThinkingMode('Enabled')).toBe('enabled');
    expect(resolveThinkingMode('ADAPTIVE')).toBe('adaptive');
  });

  it('throws on unknown values', () => {
    expect(() => resolveThinkingMode('bogus')).toThrow(/Invalid --thinking value/);
  });

  it('exposes the full allowed set', () => {
    expect(THINKING_MODES).toEqual(['enabled', 'disabled', 'adaptive']);
  });
});

describe('resolveTemperature ([0, 2] validation)', () => {
  it('returns undefined for absent / empty input', () => {
    expect(resolveTemperature(undefined)).toBeUndefined();
    expect(resolveTemperature(null)).toBeUndefined();
    expect(resolveTemperature('')).toBeUndefined();
  });

  it('accepts boundary values 0 and 2', () => {
    expect(resolveTemperature(0)).toBe(0);
    expect(resolveTemperature(2)).toBe(2);
  });

  it('accepts the documented default 1', () => {
    expect(resolveTemperature(1)).toBe(1);
  });

  it('accepts fractional values within range', () => {
    expect(resolveTemperature(0.7)).toBe(0.7);
    expect(resolveTemperature(1.5)).toBe(1.5);
  });

  it('coerces numeric strings', () => {
    expect(resolveTemperature('0.5')).toBe(0.5);
  });

  it('throws on values below 0', () => {
    expect(() => resolveTemperature(-0.01)).toThrow(/Must be in \[0, 2\]/);
  });

  it('throws on values above 2', () => {
    expect(() => resolveTemperature(2.01)).toThrow(/Must be in \[0, 2\]/);
  });

  it('throws on non-numeric strings', () => {
    expect(() => resolveTemperature('hot')).toThrow(/Must be a number/);
  });

  it('exposes the contract bounds as constants', () => {
    expect(TEMPERATURE_MIN).toBe(0);
    expect(TEMPERATURE_MAX).toBe(2);
  });
});

describe('resolveTopPDefault (model-aware per Messages API contract)', () => {
  it('returns 0.95 for MiniMax-M3 (the documented M3 default)', () => {
    expect(resolveTopPDefault('MiniMax-M3')).toBe(0.95);
  });

  it('returns 0.9 for MiniMax-M2.7 (the documented M2.x default)', () => {
    expect(resolveTopPDefault('MiniMax-M2.7')).toBe(0.9);
  });

  it('returns 0.9 for MiniMax-M2.5 (the documented M2.x default)', () => {
    expect(resolveTopPDefault('MiniMax-M2.5')).toBe(0.9);
  });

  it('returns 0.9 for unknown models (safe M2.x fallback)', () => {
    expect(resolveTopPDefault('gpt-9-snowflake')).toBe(0.9);
  });
});
