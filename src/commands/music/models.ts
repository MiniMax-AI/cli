import type { Config } from '../../config/schema';

export function musicGenerateModel(config: Config): string {
  return config.defaultMusicModel ?? 'music-2.6';
}

const VALID_COVER_MODELS = new Set(['music-cover', 'music-cover-free']);

export function musicCoverModel(config: Config): string {
  if (config.defaultMusicModel && VALID_COVER_MODELS.has(config.defaultMusicModel)) {
    return config.defaultMusicModel;
  }
  return 'music-cover';
}
