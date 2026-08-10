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

function timeoutError(message: string): DOMException {
  return new DOMException(message, 'TimeoutError');
}

function withIdleTimeout(
  response: Response,
  timeoutMs: number,
  abortController: AbortController,
): Response {
  if (!response.body) return response;

  const reader = response.body.getReader();
  let released = false;

  const releaseReader = (): void => {
    if (released) return;
    released = true;
    reader.releaseLock();
  };

  const cancelRequest = async (reason?: unknown): Promise<void> => {
    if (!abortController.signal.aborted) abortController.abort(reason);
    try {
      await reader.cancel(reason);
    } finally {
      releaseReader();
    }
  };

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let timer: ReturnType<typeof setTimeout> | undefined;

      try {
        const result = await new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
          timer = setTimeout(() => {
            const error = timeoutError(`Stream received no data for ${timeoutMs}ms.`);
            abortController.abort(error);
            reject(error);
          }, timeoutMs);

          reader.read().then(resolve, reject);
        });

        if (result.done) {
          releaseReader();
          controller.close();
        } else {
          controller.enqueue(result.value);
        }
      } catch (error) {
        await cancelRequest(error).catch(() => {});
        controller.error(error);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    cancel(reason) {
      return cancelRequest(reason);
    },
  });

  const timedResponse = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });

  // Response's constructor does not carry fetch metadata across to a wrapped body.
  Object.defineProperties(timedResponse, {
    url: { value: response.url },
    redirected: { value: response.redirected },
    type: { value: response.type },
  });

  return timedResponse;
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

  const streamAbortController = opts.stream ? new AbortController() : undefined;
  const headerTimeout = streamAbortController
    ? setTimeout(() => {
        streamAbortController.abort(timeoutError(`Request headers were not received within ${timeoutMs}ms.`));
      }, timeoutMs)
    : undefined;

  let res: Response;
  try {
    res = await fetch(opts.url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body
        ? isFormData
          ? (opts.body as FormData)
          : JSON.stringify(opts.body)
        : undefined,
      signal: streamAbortController?.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } finally {
    if (headerTimeout) clearTimeout(headerTimeout);
  }

  if (streamAbortController) {
    res = withIdleTimeout(res, timeoutMs, streamAbortController);
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
