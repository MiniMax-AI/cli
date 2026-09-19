import { describe, it, expect } from 'bun:test';
import {
  STT_DEFAULT_MODEL,
  STT_MAX_FILE_BYTES,
  sttStreamFormatConflict,
  validateSttFileSize,
} from '../../src/utils/stt';

describe('stt', () => {
  it('exposes asr-1.0 as the default model', () => {
    expect(STT_DEFAULT_MODEL).toBe('asr-1.0');
  });

  describe('validateSttFileSize', () => {
    it('accepts a file exactly at the limit', () => {
      expect(() => validateSttFileSize('clip.mp3', STT_MAX_FILE_BYTES)).not.toThrow();
    });

    it('rejects a file above the limit', () => {
      expect(() => validateSttFileSize('clip.wav', STT_MAX_FILE_BYTES + 1))
        .toThrow(/at most 50 MB/);
    });
  });

  describe('sttStreamFormatConflict', () => {
    it('allows json while streaming', () => {
      expect(sttStreamFormatConflict('json', true)).toBeUndefined();
    });

    it.each(['verbose_json', 'srt', 'vtt'])(
      'reports %s as incompatible with streaming',
      (format) => expect(sttStreamFormatConflict(format, true)).toMatch(/cannot be combined with stream=true/),
    );

    it('ignores the response format when not streaming', () => {
      expect(sttStreamFormatConflict('srt', false)).toBeUndefined();
    });
  });
});
