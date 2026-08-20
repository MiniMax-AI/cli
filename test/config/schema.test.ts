import { describe, it, expect } from 'bun:test';
import { parseConfigFile } from '../../src/config/schema';

describe('parseConfigFile', () => {
  it('returns empty object for null/undefined', () => {
    expect(parseConfigFile(null)).toEqual({});
    expect(parseConfigFile(undefined)).toEqual({});
  });

  it('returns empty object for non-objects', () => {
    expect(parseConfigFile('string')).toEqual({});
    expect(parseConfigFile(42)).toEqual({});
    expect(parseConfigFile([])).toEqual({});
  });

  it('parses valid api_key', () => {
    expect(parseConfigFile({ api_key: 'sk-cp-test' })).toEqual({ api_key: 'sk-cp-test' });
  });

  it('rejects non-string api_key', () => {
    expect(parseConfigFile({ api_key: 123 })).toEqual({});
  });

  it('accepts valid region values only', () => {
    expect(parseConfigFile({ region: 'global' }).region).toBe('global');
    expect(parseConfigFile({ region: 'cn' }).region).toBe('cn');
    expect(parseConfigFile({ region: 'us' }).region).toBeUndefined();
    expect(parseConfigFile({ region: '' }).region).toBeUndefined();
  });

  it('accepts base_url only when starts with http', () => {
    expect(parseConfigFile({ base_url: 'https://custom.api.com' }).base_url).toBe('https://custom.api.com');
    expect(parseConfigFile({ base_url: 'http://localhost:8080' }).base_url).toBe('http://localhost:8080');
    expect(parseConfigFile({ base_url: 'not-a-url' }).base_url).toBeUndefined();
    expect(parseConfigFile({ base_url: 123 }).base_url).toBeUndefined();
  });

  it('accepts valid output values only', () => {
    expect(parseConfigFile({ output: 'text' }).output).toBe('text');
    expect(parseConfigFile({ output: 'json' }).output).toBe('json');
    expect(parseConfigFile({ output: 'xml' }).output).toBeUndefined();
  });

  it('accepts positive timeout', () => {
    expect(parseConfigFile({ timeout: 300 }).timeout).toBe(300);
    expect(parseConfigFile({ timeout: 0 }).timeout).toBeUndefined();
    expect(parseConfigFile({ timeout: -1 }).timeout).toBeUndefined();
    expect(parseConfigFile({ timeout: '300' }).timeout).toBeUndefined();
  });

  it('accepts proxy only when starts with http', () => {
    expect(parseConfigFile({ proxy: 'http://proxy:8080' }).proxy).toBe('http://proxy:8080');
    expect(parseConfigFile({ proxy: 'socks5://proxy' }).proxy).toBeUndefined();
  });

  it('parses valid OAuth credentials', () => {
    const cfg = parseConfigFile({
      oauth: {
        access_token: 'at-123',
        refresh_token: 'rt-456',
        expires_at: '2026-01-01T00:00:00Z',
        region: 'global',
        resource_url: 'https://api.example.com',
        account: 'user@test.com',
      },
    });
    expect(cfg.oauth).toBeDefined();
    expect(cfg.oauth!.access_token).toBe('at-123');
    expect(cfg.oauth!.refresh_token).toBe('rt-456');
    expect(cfg.oauth!.expires_at).toBe('2026-01-01T00:00:00Z');
    expect(cfg.oauth!.region).toBe('global');
    expect(cfg.oauth!.resource_url).toBe('https://api.example.com');
    expect(cfg.oauth!.account).toBe('user@test.com');
  });

  it('rejects OAuth missing access_token', () => {
    expect(parseConfigFile({ oauth: { refresh_token: 'rt', expires_at: '...' } }).oauth).toBeUndefined();
  });

  it('rejects OAuth missing refresh_token', () => {
    expect(parseConfigFile({ oauth: { access_token: 'at', expires_at: '...' } }).oauth).toBeUndefined();
  });

  it('rejects OAuth missing expires_at', () => {
    expect(parseConfigFile({ oauth: { access_token: 'at', refresh_token: 'rt' } }).oauth).toBeUndefined();
  });

  it('parses default model settings', () => {
    const cfg = parseConfigFile({
      default_text_model: 'MiniMax-M3',
      default_speech_model: 'speech-2.8-hd',
      default_video_model: 'MiniMax-Hailuo-2.3',
    });
    expect(cfg.default_text_model).toBe('MiniMax-M3');
    expect(cfg.default_speech_model).toBe('speech-2.8-hd');
    expect(cfg.default_video_model).toBe('MiniMax-Hailuo-2.3');
  });

  it('rejects empty string default model', () => {
    expect(parseConfigFile({ default_text_model: '' }).default_text_model).toBeUndefined();
  });

  it('handles full valid config', () => {
    const cfg = parseConfigFile({
      api_key: 'sk-cp-test',
      region: 'cn',
      base_url: 'https://api.minimaxi.com',
      output: 'json',
      timeout: 120,
      proxy: 'http://proxy:3128',
      default_text_model: 'MiniMax-M3',
    });
    expect(cfg.api_key).toBe('sk-cp-test');
    expect(cfg.region).toBe('cn');
    expect(cfg.base_url).toBe('https://api.minimaxi.com');
    expect(cfg.output).toBe('json');
    expect(cfg.timeout).toBe(120);
    expect(cfg.proxy).toBe('http://proxy:3128');
    expect(cfg.default_text_model).toBe('MiniMax-M3');
  });

  it('silently ignores unknown keys', () => {
    const cfg = parseConfigFile({ unknown_key: 'value', api_key: 'sk-test' });
    expect(cfg.api_key).toBe('sk-test');
    expect((cfg as Record<string, unknown>).unknown_key).toBeUndefined();
  });
});
