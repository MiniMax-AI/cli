import type { Config } from '../config/schema';
import type { ApiErrorBody } from '../errors/api';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import { resolveCredential } from '../auth/resolver';
import { mapApiError } from '../errors/api';
import { maybeShowStatusBar } from '../output/status-bar';
import { CLI_VERSION } from '../version';

export interface RequestOpts {
  url: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
  stream?: boolean;
  noAuth?: boolean;
  authStyle?: 'bearer' | 'x-api-key';
}

const MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 30_000;
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (value === null) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

export function retryDelayMs(
  retryNumber: number,
  retryAfter: string | null,
  now = Date.now(),
  random = Math.random(),
): number {
  const serverDelay = parseRetryAfter(retryAfter, now);
  if (serverDelay !== undefined) {
    return Math.min(serverDelay, MAX_RETRY_DELAY_MS);
  }

  const exponentialDelay = BASE_RETRY_DELAY_MS * 2 ** (retryNumber - 1);
  return Math.min(exponentialDelay * Math.max(0, Math.min(random, 1)), MAX_RETRY_DELAY_MS);
}

function isRetryableNetworkError(error: unknown): boolean {
  return error instanceof TypeError ||
    (error instanceof DOMException && error.name === 'TimeoutError');
}

async function waitBeforeRetry(retryNumber: number, retryAfter: string | null): Promise<void> {
  const delay = retryDelayMs(retryNumber, retryAfter);
  if (delay <= 0) return;
  await new Promise(resolve => setTimeout(resolve, delay));
}

export async function request(config: Config, opts: RequestOpts): Promise<Response> {
  const isFormData = typeof FormData !== 'undefined' && opts.body instanceof FormData;

  const headers: Record<string, string> = {
    'User-Agent': `mmx-cli/${CLI_VERSION}`,
    ...opts.headers,
  };

  if (!isFormData && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  if (!opts.noAuth) {
    const credential = await resolveCredential(config);

    if (opts.authStyle === 'x-api-key') {
      headers['x-api-key'] = credential.token;
    } else {
      headers['Authorization'] = `Bearer ${credential.token}`;
    }

    if (config.verbose) {
      process.stderr.write(`> ${opts.method ?? 'GET'} ${opts.url}\n`);
      process.stderr.write(`> Auth: ${credential.token.slice(0, 8)}...\n`);
    }

    const model =
      opts.body && typeof opts.body === 'object' && 'model' in opts.body
        ? String((opts.body as Record<string, unknown>).model)
        : undefined;

    maybeShowStatusBar(config, credential.token, model);
  }

  const timeoutMs = (opts.timeout ?? config.timeout) * 1000;
  const requestBody = opts.body
    ? isFormData
      ? (opts.body as FormData)
      : JSON.stringify(opts.body)
    : undefined;

  let res: Response | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      res = await fetch(opts.url, {
        method: opts.method ?? 'GET',
        headers,
        body: requestBody,
        signal: opts.stream ? undefined : AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (attempt === MAX_ATTEMPTS || !isRetryableNetworkError(error)) throw error;
      await waitBeforeRetry(attempt, null);
      continue;
    }

    if (!RETRYABLE_STATUSES.has(res.status) || attempt === MAX_ATTEMPTS) break;

    const retryAfter = res.headers.get('retry-after');
    await res.body?.cancel();
    await waitBeforeRetry(attempt, retryAfter);
  }

  if (!res) {
    throw new Error('HTTP request completed without a response');
  }

  if (config.verbose) {
    process.stderr.write(`< ${res.status} ${res.statusText}\n`);
  }

  if (!res.ok) {
    let body: ApiErrorBody = {};
    try { body = (await res.json()) as ApiErrorBody; } catch { /* non-JSON */ }
    throw mapApiError(res.status, body, opts.url);
  }

  return res;
}

export async function requestJson<T>(config: Config, opts: RequestOpts): Promise<T> {
  const res = await request(config, opts);
  let data: T & { base_resp?: { status_code?: number; status_msg?: string } };
  try {
    data = (await res.json()) as T & { base_resp?: { status_code?: number; status_msg?: string } };
  } catch {
    const contentType = res.headers.get('content-type') || '';
    throw new CLIError(
      `API returned non-JSON response (${contentType || 'unknown type'}). Server may be experiencing issues.`,
      ExitCode.GENERAL,
    );
  }

  if (data.base_resp?.status_code && data.base_resp.status_code !== 0) {
    throw mapApiError(200, { base_resp: data.base_resp }, opts.url);
  }

  return data;
}
