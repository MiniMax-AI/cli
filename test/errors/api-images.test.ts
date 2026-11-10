import { describe, it, expect } from 'bun:test';
import { mapApiError } from '../../src/errors/api';
import { ExitCode } from '../../src/errors/codes';

describe('mapApiError (OpenAI-style /v1/images/* errors)', () => {
  const url = 'https://api.minimax.io/v1/images/generations';

  it('maps an all-images content safety failure (1027) to CONTENT_FILTER', () => {
    const err = mapApiError(422, {
      error: {
        type: 'unprocessable_entity_error',
        message: 'no image generated: all 2 images failed content safety check (1027)',
        http_code: '422',
      },
    }, url);
    expect(err.exitCode).toBe(ExitCode.CONTENT_FILTER);
  });

  it('maps an input safety failure (1026) to CONTENT_FILTER', () => {
    const err = mapApiError(422, {
      error: { type: 'unprocessable_entity_error', message: 'input content failed safety check: prompt (1026)' },
    }, url);
    expect(err.exitCode).toBe(ExitCode.CONTENT_FILTER);
  });

  it('maps 2068 (plan tier lacks the model) to a plan message', () => {
    const err = mapApiError(402, {
      error: { type: 'insufficient_balance_error', message: 'model not supported by current plan (2068)' },
    }, url);
    expect(err.exitCode).toBe(ExitCode.QUOTA);
    expect(err.message).toContain('not available on your current plan');
  });

  it('lists per-image reasons when every image fails', () => {
    const err = mapApiError(500, {
      error: { type: 'api_error', message: 'no image generated: all 2 images failed (1000)' },
      data: [
        { error: { code: '1027', message: 'output image failed content safety check' } },
        { error: { code: '1000', message: 'internal error' } },
      ],
    }, url);
    expect(err.hint).toContain('Image 1 (1027): output image failed content safety check');
    expect(err.hint).toContain('Image 2 (1000): internal error');
  });

  it('keeps 2068 handling scoped to /v1/images/*', () => {
    const err = mapApiError(400, { base_resp: { status_code: 2068, status_msg: 'x' } }, 'https://api.minimax.io/v1/t2a_v2');
    expect(err.exitCode).toBe(ExitCode.GENERAL);
  });

  it('only parses trailing codes on /v1/images/* endpoints', () => {
    const err = mapApiError(400, {
      error: { type: 'bad_request_error', message: 'something odd (1002)' },
    }, 'https://api.minimax.io/v1/text/chatcompletion_v2');
    expect(err.exitCode).toBe(ExitCode.GENERAL);
  });

  it('keeps generic 400 errors as API errors', () => {
    const err = mapApiError(400, {
      error: { type: 'bad_request_error', message: 'invalid params, size 4096x1024: aspect ratio must be within 1:3 and 3:1 (2013)' },
    }, url);
    expect(err.exitCode).toBe(ExitCode.GENERAL);
    expect(err.message).toContain('(2013)');
  });
});
