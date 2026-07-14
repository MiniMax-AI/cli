import { describe, it, expect } from 'bun:test';
import { musicGenerateModel, musicCoverModel } from '../../../src/commands/music/models';
import type { Config } from '../../../src/config/schema';

describe('music models', () => {
  it('musicGenerateModel uses defaultMusicModel when set', () => {
    const config = { defaultMusicModel: 'music-2.5+' } as Config;
    expect(musicGenerateModel(config)).toBe('music-2.5+');
  });

  it('musicGenerateModel defaults to music-2.6', () => {
    expect(musicGenerateModel({} as Config)).toBe('music-2.6');
  });

  it('musicGenerateModel accepts the free-tier model', () => {
    const config = { defaultMusicModel: 'music-2.6-free' } as Config;
    expect(musicGenerateModel(config)).toBe('music-2.6-free');
  });

  it('musicCoverModel ignores defaultMusicModel for non-cover models', () => {
    const config = { defaultMusicModel: 'music-2.6' } as Config;
    expect(musicCoverModel(config)).toBe('music-cover');
  });

  it('musicCoverModel uses defaultMusicModel when it is a cover model', () => {
    const config = { defaultMusicModel: 'music-cover' } as Config;
    expect(musicCoverModel(config)).toBe('music-cover');
  });

  it('musicCoverModel accepts the free-tier cover model', () => {
    const config = { defaultMusicModel: 'music-cover-free' } as Config;
    expect(musicCoverModel(config)).toBe('music-cover-free');
  });

  it('musicCoverModel defaults to music-cover', () => {
    expect(musicCoverModel({} as Config)).toBe('music-cover');
  });
});
