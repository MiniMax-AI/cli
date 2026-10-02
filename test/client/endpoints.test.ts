import { describe, it, expect } from 'bun:test';
import {
  fileRetrieveEndpoint,
  fileUploadEndpoint,
  quotaEndpoint,
  usageEndpoint,
  videoTaskEndpoint,
  videoTaskV2Endpoint,
} from '../../src/client/endpoints';

describe('quotaEndpoint', () => {
  it('uses token_plan/remains for global', () => {
    expect(quotaEndpoint('https://api.minimax.io')).toBe('https://api.minimax.io/v1/token_plan/remains');
  });

  it('uses token_plan/remains for cn', () => {
    expect(quotaEndpoint('https://api.minimax.cn')).toBe('https://api.minimax.cn/v1/token_plan/remains');
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

describe('parameter encoding security in endpoints', () => {
  it('encodes query parameters in videoTaskEndpoint to prevent injection', () => {
    expect(videoTaskEndpoint('https://api.minimax.io', 'task123'))
      .toBe('https://api.minimax.io/v1/query/video_generation?task_id=task123');

    // Injection attempt with query parameter and fragment
    const maliciousTask = '123&admin=true#fragment';
    expect(videoTaskEndpoint('https://api.minimax.io', maliciousTask))
      .toBe('https://api.minimax.io/v1/query/video_generation?task_id=123%26admin%3Dtrue%23fragment');
  });

  it('encodes path parameters in videoTaskV2Endpoint to prevent path traversal', () => {
    expect(videoTaskV2Endpoint('https://api.minimax.io', 'task456'))
      .toBe('https://api.minimax.io/v2/query/video_generation/task456');

    // Traversal or injection attempt
    const maliciousTask = '../../admin?extra=1';
    expect(videoTaskV2Endpoint('https://api.minimax.io', maliciousTask))
      .toBe('https://api.minimax.io/v2/query/video_generation/..%2F..%2Fadmin%3Fextra%3D1');
  });

  it('encodes query parameters in fileRetrieveEndpoint to prevent injection', () => {
    expect(fileRetrieveEndpoint('https://api.minimax.io', 'file_xyz'))
      .toBe('https://api.minimax.io/v1/files/retrieve?file_id=file_xyz');

    // Injection attempt
    const maliciousFile = 'file1&download=true&token=leak';
    expect(fileRetrieveEndpoint('https://api.minimax.io', maliciousFile))
      .toBe('https://api.minimax.io/v1/files/retrieve?file_id=file1%26download%3Dtrue%26token%3Dleak');
  });
});

