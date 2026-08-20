import { describe, it, expect } from 'bun:test';
import {
  T2A_FORMATS,
  formatList,
  validateAudioFormat,
  validateT2AStreaming,
  t2aDefaultSampleRate,
} from '../../src/utils/audio-formats';

describe('audio-formats', () => {
  describe('T2A_FORMATS', () => {
    it.each(['mp3', 'pcm', 'flac', 'wav', 'pcmu_raw', 'pcmu_wav', 'opus'] as const)(
      'accepts %s',
      (fmt) => expect(() => validateAudioFormat(fmt, T2A_FORMATS)).not.toThrow(),
    );

    it.each(['aac', 'ogg', 'wma', 'mp4', ''])(
      'rejects %s',
      (fmt) => expect(() => validateAudioFormat(fmt, T2A_FORMATS)).toThrow(/Invalid audio format/),
    );
  });

  describe('validateT2AStreaming', () => {
    it('rejects wav in streaming mode', () => {
      expect(() => validateT2AStreaming('wav', true)).toThrow(/wav format is not supported in streaming/);
    });

    it('allows wav in non-streaming mode', () => {
      expect(() => validateT2AStreaming('wav', false)).not.toThrow();
    });

    it.each(['mp3', 'pcm', 'flac', 'pcmu_raw', 'pcmu_wav', 'opus'])(
      'allows %s in streaming mode',
      (fmt) => expect(() => validateT2AStreaming(fmt, true)).not.toThrow(),
    );
  });

  describe('formatList', () => {
    it('joins formats with comma-space', () => {
      expect(formatList(['a', 'b', 'c'])).toBe('a, b, c');
    });
  });

  describe('t2aDefaultSampleRate', () => {
    it('returns 24000 for opus', () => {
      expect(t2aDefaultSampleRate('opus', 32000)).toBe(24000);
    });

    it('returns 8000 for pcmu_raw', () => {
      expect(t2aDefaultSampleRate('pcmu_raw', 32000)).toBe(8000);
    });

    it('returns 8000 for pcmu_wav', () => {
      expect(t2aDefaultSampleRate('pcmu_wav', 32000)).toBe(8000);
    });

    it('returns fallback for mp3', () => {
      expect(t2aDefaultSampleRate('mp3', 32000)).toBe(32000);
    });
  });
});
