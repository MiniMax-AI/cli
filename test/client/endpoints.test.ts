import { describe, it, expect } from 'bun:test';
import { fileUploadEndpoint, quotaEndpoint } from '../../src/client/endpoints';

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
