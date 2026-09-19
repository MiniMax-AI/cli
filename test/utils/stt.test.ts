import { describe, it, expect } from 'bun:test';
import { CLIError, SDKError } from '../../src/errors/base';
import {
  STT_DEFAULT_MODEL,
  STT_MAX_FILE_BYTES,
  isSubtitleFormat,
  sttFormFields,
  validateSttFileSize,
  validateSttResponseFormat,
  validateSttStreaming,
} from '../../src/utils/stt';

describe('stt', () => {
  it('exposes asr-1.0 as the default model', () => {
    expect(STT_DEFAULT_MODEL).toBe('asr-1.0');
  });

  describe('sttFormFields', () => {
    it('defaults to asr-1.0 and json', () => {
      expect(sttFormFields({})).toEqual({ model: 'asr-1.0', response_format: 'json' });
    });

    it('encodes stream as the multipart string "true"', () => {
      expect(sttFormFields({ stream: true })).toEqual({
        model: 'asr-1.0',
        response_format: 'json',
        stream: 'true',
      });
    });

    it('passes model, response_format, and timestamp_level through', () => {
      expect(
        sttFormFields({ model: 'asr-1.0', response_format: 'verbose_json', timestamp_level: 'word' }),
      ).toEqual({
        model: 'asr-1.0',
        response_format: 'verbose_json',
        timestamp_level: 'word',
      });
    });
  });

  describe('isSubtitleFormat', () => {
    it.each(['srt', 'vtt'])('treats %s as a subtitle document', (format) => {
      expect(isSubtitleFormat(format)).toBe(true);
    });

    it.each(['json', 'verbose_json'])('treats %s as json', (format) => {
      expect(isSubtitleFormat(format)).toBe(false);
    });
  });

  describe('validateSttResponseFormat', () => {
    it.each(['json', 'verbose_json', 'srt', 'vtt'])('accepts %s', (format) => {
      expect(() => validateSttResponseFormat(format)).not.toThrow();
    });

    it('rejects an unknown format, naming the response format', () => {
      expect(() => validateSttResponseFormat('txt')).toThrow(
        /Invalid response format "txt". Supported: json, verbose_json, srt, vtt/,
      );
    });
  });

  describe('validateSttStreaming', () => {
    it('allows json while streaming', () => {
      expect(() => validateSttStreaming('json', true)).not.toThrow();
    });

    it.each(['verbose_json', 'srt', 'vtt'])('rejects %s while streaming', (format) => {
      expect(() => validateSttStreaming(format, true))
        .toThrow(/cannot be combined with stream=true/);
    });

    it('ignores the response format when not streaming', () => {
      expect(() => validateSttStreaming('srt', false)).not.toThrow();
    });
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

  describe('error class', () => {
    it('defaults to CLIError', () => {
      try {
        validateSttResponseFormat('txt');
        throw new Error('Expected validateSttResponseFormat to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(CLIError);
        expect(error).not.toBeInstanceOf(SDKError);
      }
    });

    it('raises the error class the caller passes, keeping message and exit code', () => {
      try {
        validateSttFileSize('clip.wav', STT_MAX_FILE_BYTES + 1, SDKError);
        throw new Error('Expected validateSttFileSize to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(SDKError);
        expect((error as SDKError).exitCode).toBe(2);
        expect((error as SDKError).hint).toContain('Re-encode');
      }
    });
  });
});
