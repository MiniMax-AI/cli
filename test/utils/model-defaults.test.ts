import { describe, it, expect } from 'bun:test';
import type { Config } from '../../src/config/schema';

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
    const model = resolveModel('defaultTextModel', 'MiniMax-M2.7', baseConfig, { model: 'MiniMax-M2.7-highspeed' });
    expect(model).toBe('MiniMax-M2.7-highspeed');
  });

  it('falls back to config default when flag is absent', () => {
    const model = resolveModel('defaultTextModel', 'MiniMax-M2.7', { ...baseConfig, defaultTextModel: 'MiniMax-M2.7-highspeed' }, {});
    expect(model).toBe('MiniMax-M2.7-highspeed');
  });

  it('falls back to hardcoded when neither flag nor config', () => {
    const model = resolveModel('defaultTextModel', 'MiniMax-M2.7', baseConfig, {});
    expect(model).toBe('MiniMax-M2.7');
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
    const model = resolveModel('defaultMusicModel', 'music-2.6-free', { ...baseConfig, defaultMusicModel: 'music-2.6' }, {});
    expect(model).toBe('music-2.6');
  });
});
