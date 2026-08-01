import { describe, it, expect } from 'bun:test';
import { fileUploadEndpoint, quotaEndpoint, usageEndpoint } from '../../src/client/endpoints';

describe('quotaEndpoint', () => {
  it('uses token_plan/remains for global', () => {
    expect(quotaEndpoint('https://api.minimax.io')).toBe('https://api.minimax.io/v1/token_plan/remains');
  });

  it('uses token_plan/remains for cn', () => {
    expect(quotaEndpoint('https://api.minimaxi.com')).toBe('https://api.minimaxi.com/v1/token_plan/remains');
  });

  it('honors a custom base URL', () => {
    expect(quotaEndpoint('https://gateway.example.com')).toBe('https://gateway.example.com/v1/token_plan/remains');
  });
});

describe('fileUploadEndpoint', () => {
  it('uses the documented file upload path', () => {
    expect(fileUploadEndpoint('https://api.minimax.io')).toBe('https://api.minimax.io/v1/files/upload');
  });
});

describe('usageEndpoint', () => {
  it('uses token_plan/remains for normal api keys', () => {
    expect(usageEndpoint('https://api.minimax.io', 'sk-abc')).toBe('https://api.minimax.io/v1/token_plan/remains');
  });

  it('uses account/query_balance for secret api keys', () => {
    expect(usageEndpoint('https://api.minimax.io', 'sk-api-abc')).toBe('https://api.minimax.io/account/query_balance');
  });
});
