import type { Config } from '../config/schema';
import type { ApiErrorBody } from '../errors/api';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import { resolveCredential } from '../auth/resolver';
import { mapApiError } from '../errors/api';
import { maybeShowStatusBar } from '../output/status-bar';
import { proxyFetch } from './proxy';

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

export async function request(config: Config, opts: RequestOpts): Promise<Response> {
  const isFormData = typeof FormData !== 'undefined' && opts.body instanceof FormData;

  const version = process.env.CLI_VERSION ?? '1.0.4';
  const headers: Record<string, string> = {
    'User-Agent': `mmx-cli/${version}`,
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

  const res = await proxyFetch(opts.url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body
      ? isFormData
        ? (opts.body as FormData)
        : JSON.stringify(opts.body)
      : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });

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
