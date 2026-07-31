import type { Config } from '../../config/schema';

export const MUSIC_GENERATE_MODELS = [
  'music-3.0',
  'music-2.6',
  'music-2.6-free',
  'music-2.5+',
  'music-2.5',
] as const;

export const MUSIC_COVER_MODELS = ['music-cover', 'music-cover-free'] as const;

function includesModel(models: readonly string[], model: string): boolean {
  return models.includes(model);
}

export function musicGenerateModel(config: Config): string {
  if (
    config.defaultMusicModel
    && includesModel(MUSIC_GENERATE_MODELS, config.defaultMusicModel)
  ) {
    return config.defaultMusicModel;
  }
  return 'music-3.0';
}

export function musicCoverModel(config: Config): string {
  if (
    config.defaultMusicModel
    && includesModel(MUSIC_COVER_MODELS, config.defaultMusicModel)
  ) {
    return config.defaultMusicModel;
  }
  return 'music-cover';
}
