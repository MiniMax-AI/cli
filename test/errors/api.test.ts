import { describe, it, expect } from 'bun:test';
import { mapApiError } from '../../src/errors/api';
import { ExitCode } from '../../src/errors/codes';

describe('mapApiError', () => {
  it('maps 401 to AUTH exit code', () => {
    const err = mapApiError(401, {});
    expect(err.exitCode).toBe(ExitCode.AUTH);
    expect(err.message).toContain('401');
  });

  it('maps 403 to AUTH exit code', () => {
    const err = mapApiError(403, {});
    expect(err.exitCode).toBe(ExitCode.AUTH);
  });

  it('maps 429 to QUOTA exit code', () => {
    const err = mapApiError(429, { base_resp: { status_code: 0, status_msg: 'rate limited' } });
    expect(err.exitCode).toBe(ExitCode.QUOTA);
  });

  it('maps Video V2 insufficient balance errors to QUOTA', () => {
    const err = mapApiError(402, {
      error: {
        type: 'insufficient_balance_error',
        message: 'insufficient balance (1008)',
        http_code: '402',
      },
    });

    expect(err.exitCode).toBe(ExitCode.QUOTA);
    expect(err.message).toContain('insufficient balance');
    expect(err.hint).toContain('account balance');
  });

  it('maps 408 to TIMEOUT exit code', () => {
    const err = mapApiError(408, {});
    expect(err.exitCode).toBe(ExitCode.TIMEOUT);
  });

  it('maps MiniMax content filter code 1002', () => {
    const err = mapApiError(400, { base_resp: { status_code: 1002, status_msg: 'content filtered' } });
    expect(err.exitCode).toBe(ExitCode.CONTENT_FILTER);
  });

  it('maps Video V2 sensitive-content errors to CONTENT_FILTER', () => {
    const err = mapApiError(422, {
      error: {
        type: 'unprocessable_entity_error',
        message: '视频描述包含敏感内容 (1026)',
        http_code: '422',
      },
    });

    expect(err.exitCode).toBe(ExitCode.CONTENT_FILTER);
    expect(err.message).toContain('视频描述包含敏感内容');
  });

  it('keeps unrelated Video V2 validation errors as GENERAL', () => {
    const err = mapApiError(422, {
      error: {
        type: 'unprocessable_entity_error',
        message: 'invalid media dimensions',
        http_code: '422',
      },
    });

    expect(err.exitCode).toBe(ExitCode.GENERAL);
  });

  it('maps MiniMax quota code 1028', () => {
    const err = mapApiError(400, { base_resp: { status_code: 1028, status_msg: 'quota exhausted' } });
    expect(err.exitCode).toBe(ExitCode.QUOTA);
  });

  it('maps output sensitivity (HTTP 200) to CONTENT_FILTER', () => {
    const err = mapApiError(200, {
      base_resp: { status_code: 2001, status_msg: 'output new_sensitive' },
    });
    expect(err.exitCode).toBe(ExitCode.CONTENT_FILTER);
    expect(err.message).toContain('content moderation');
    expect(err.message).toContain('output new_sensitive');
    expect(err.hint).toBeDefined();
  });

  it('maps output sensitivity code 1027 to CONTENT_FILTER', () => {
    const err = mapApiError(200, {
      base_resp: { status_code: 1027, status_msg: '输出内容涉敏' },
    });
    expect(err.exitCode).toBe(ExitCode.CONTENT_FILTER);
  });

  it('maps input sensitivity code 1026 to CONTENT_FILTER (not output)', () => {
    const err = mapApiError(200, {
      base_resp: { status_code: 1026, status_msg: 'input new_sensitive' },
    });
    expect(err.exitCode).toBe(ExitCode.CONTENT_FILTER);
    expect(err.message).toContain('Input');
    expect(err.message).not.toContain('Output withheld');
  });

  it('maps unknown errors to GENERAL', () => {
    const err = mapApiError(500, { base_resp: { status_code: 0, status_msg: 'internal error' } });
    expect(err.exitCode).toBe(ExitCode.GENERAL);
  });

  it('includes API message in error', () => {
    const err = mapApiError(500, { base_resp: { status_code: 0, status_msg: 'something broke' } });
    expect(err.message).toContain('something broke');
  });
});
