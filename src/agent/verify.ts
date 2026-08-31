import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import { parseSSE } from '../client/stream';
import { endpointsForRegion } from './configurator';
import type { AgentVerification } from './types';
import type { Region } from '../config/schema';

const PROXY_ENV_KEYS = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
] as const;

function networkErrorDetails(error: unknown): { code?: string; text: string } {
  let code: string | undefined;
  const text: string[] = [];
  const pending: unknown[] = [error];
  const seen = new Set<object>();

  while (pending.length > 0 && seen.size < 10) {
    const current = pending.shift();
    if (typeof current === 'string') {
      text.push(current);
      continue;
    }
    if (typeof current !== 'object' || current === null || seen.has(current)) continue;
    seen.add(current);

    if (current instanceof Error) {
      text.push(current.name, current.message);
    }
    const record = current as Record<string, unknown>;
    if (!code && typeof record.code === 'string') code = record.code.toUpperCase();
    if (record.cause !== undefined) pending.push(record.cause);
    if (Array.isArray(record.errors)) pending.push(...record.errors);
  }

  return { code, text: text.join(' ').toLowerCase() };
}

function networkVerificationError(
  error: unknown,
  endpoint: string,
  timeoutSeconds: number,
  proxyConfigured: boolean,
  readingResponse = false,
): CLIError {
  const host = new URL(endpoint).hostname;
  const details = networkErrorDetails(error);
  const isTimeout = details.code === 'ETIMEDOUT'
    || details.code === 'UND_ERR_CONNECT_TIMEOUT'
    || details.text.includes('timeouterror')
    || details.text.includes('aborterror')
    || details.text.includes('timed out');
  const isDns = details.code === 'EAI_AGAIN'
    || details.code === 'ENOTFOUND'
    || details.text.includes('getaddrinfo');
  const isConnection = details.code === 'ECONNREFUSED'
    || details.code === 'ECONNRESET'
    || details.code === 'ENETUNREACH';
  const unchanged = 'No agent configuration files were changed.';
  const proxyHint = 'If your network uses a proxy, set HTTPS_PROXY and make sure it is available '
    + 'in the current shell or container.';
  const technicalDetail = details.code ? `\nTechnical detail: ${details.code}.` : '';
  let message = `Could not reach ${host}.`;
  let exitCode: ExitCode = ExitCode.NETWORK;
  let hint = 'Check your internet connection, DNS, firewall, and proxy, then try again.';

  if (isTimeout) {
    message = proxyConfigured
      ? `Connection to ${host} through the configured proxy timed out after ${timeoutSeconds} seconds.`
      : `Connection to ${host} timed out after ${timeoutSeconds} seconds.`;
    exitCode = ExitCode.TIMEOUT;
    hint = proxyConfigured
      ? 'Check the proxy address and make sure it is reachable from the current shell or container.'
      : `Check your connection, firewall, and selected MiniMax region.\n${proxyHint}`;
  } else if (readingResponse) {
    message = `Connection to ${host} was interrupted while reading the verification response.`;
    hint = `Try again and check your network connection and proxy.`;
  } else if (proxyConfigured || details.text.includes('proxy')) {
    message = `Could not reach ${host} through the configured proxy.`;
    hint = 'Check the proxy address and make sure it is reachable from the current shell or container.';
  } else if (isDns) {
    message = `Could not resolve ${host}.`;
    hint = `Check DNS and internet access, then try again.\n${proxyHint}`;
  } else if (isConnection) {
    message = `Could not connect to ${host}.`;
    hint = `Check your internet connection, firewall, and selected MiniMax region.\n${proxyHint}`;
  }

  return new CLIError(message, exitCode, `${unchanged}\n${hint}${technicalDetail}`);
}

function httpVerificationError(status: number): CLIError {
  const unchanged = 'No agent configuration files were changed.';
  if (status === 401 || status === 403) {
    return new CLIError(
      `MiniMax rejected the API key (HTTP ${status}).`,
      ExitCode.AUTH,
      `${unchanged}\nCheck that the API key type and selected MiniMax region are correct.`,
    );
  }
  if (status === 408 || status === 504) {
    return new CLIError(
      `MiniMax verification timed out (HTTP ${status}).`,
      ExitCode.TIMEOUT,
      `${unchanged}\nCheck your connection and try again.`,
    );
  }
  if (status === 402) {
    return new CLIError(
      'MiniMax quota or balance is insufficient (HTTP 402).',
      ExitCode.QUOTA,
      `${unchanged}\nCheck the quota or balance for this API key.`,
    );
  }
  if (status === 429) {
    return new CLIError(
      'MiniMax verification was rate limited (HTTP 429).',
      ExitCode.QUOTA,
      `${unchanged}\nWait and try again, or check the quota for this API key.`,
    );
  }
  if (status >= 500) {
    return new CLIError(
      `MiniMax is temporarily unavailable (HTTP ${status}).`,
      ExitCode.GENERAL,
      `${unchanged}\nTry again later.`,
    );
  }
  return new CLIError(
    `MiniMax rejected the agent verification request (HTTP ${status}).`,
    ExitCode.GENERAL,
    `${unchanged}\nCheck the selected MiniMax region and model.`,
  );
}

export async function verifyAgentCredential(options: {
  apiKey: string;
  region: Region;
  model: string;
  timeoutSeconds?: number;
  proxy?: string;
}): Promise<AgentVerification> {
  const endpoint = `${endpointsForRegion(options.region).openai}/responses`;
  const timeoutSeconds = options.timeoutSeconds ?? 30;
  const environmentProxy = PROXY_ENV_KEYS
    .map(key => process.env[key]?.trim())
    .find((value): value is string => Boolean(value));
  const bunProxy = environmentProxy ?? options.proxy;
  const proxyConfigured = Boolean(environmentProxy || options.proxy);
  let response: Response;
  try {
    const requestOptions: RequestInit & { proxy?: string } = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options.model,
        input: 'Reply with exactly OK.',
        max_output_tokens: 16,
        stream: true,
      }),
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
    };
    if (bunProxy && process.versions.bun) requestOptions.proxy = bunProxy;
    response = await fetch(endpoint, requestOptions);
  } catch (error) {
    throw networkVerificationError(
      error,
      endpoint,
      timeoutSeconds,
      proxyConfigured,
    );
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw httpVerificationError(response.status);
  }

  let verified = false;
  try {
    for await (const event of parseSSE(response)) {
      let payload: unknown;
      try {
        payload = JSON.parse(event.data) as unknown;
      } catch {
        continue;
      }
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) continue;
      const record = payload as Record<string, unknown>;
      const created = record.response;
      if (record.type === 'response.created'
        && typeof created === 'object'
        && created !== null
        && !Array.isArray(created)
        && typeof (created as Record<string, unknown>).id === 'string'
        && typeof (created as Record<string, unknown>).model === 'string') {
        verified = true;
        break;
      }
    }
  } catch (error) {
    throw networkVerificationError(error, endpoint, timeoutSeconds, proxyConfigured, true);
  } finally {
    await response.body?.cancel().catch(() => undefined);
  }

  if (!verified) {
    throw new CLIError(
      'MiniMax returned an invalid agent verification response.',
      ExitCode.GENERAL,
      'No agent configuration files were changed. Check --region, --model, and the API key.',
    );
  }

  return {
    region: options.region,
    model: options.model,
    endpoint,
    status: 'ok',
  };
}
