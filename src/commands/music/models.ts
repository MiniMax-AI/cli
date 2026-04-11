import type { Config } from '../../config/schema';

/**
 * sk-cp-xxx = Token Plan (coding plan) → standard models (music-2.6, music-cover)
 * sk-api-xxx / other = Pay as you go → free-tier models (music-2.6-free, music-cover-free)
 */
export function isCodingPlan(config: Config): boolean {
  const key = config.apiKey ?? config.fileApiKey ?? '';
  return key.startsWith('sk-cp-');
}

export function musicGenerateModel(config: Config): string {
  // Config default > key-type-based default
  if (config.defaultMusicModel) return config.defaultMusicModel;
  return isCodingPlan(config) ? 'music-2.6' : 'music-2.6-free';
}

const VALID_COVER_MODELS = new Set(['music-cover', 'music-cover-free']);

export function musicCoverModel(config: Config): string {
  // Config default (only if it's a valid cover model) > key-type-based default
  if (config.defaultMusicModel && VALID_COVER_MODELS.has(config.defaultMusicModel)) {
    return config.defaultMusicModel;
  }
  return isCodingPlan(config) ? 'music-cover' : 'music-cover-free';
}
