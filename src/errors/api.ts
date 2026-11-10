import { CLIError } from './base';
import { ExitCode } from './codes';

export interface ApiErrorBody {
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
  error?: {
    message?: string;
    type?: string;
    code?: number;
    http_code?: string | number;
  };
  /** Endpoint-specific; on /v1/images/* it holds per-image failure reasons when every image fails. */
  data?: unknown;
}

function planHintForUrl(url?: string): string {
  if (!url) return '';
  if (url.includes('/t2a'))              return '\n\nSpeech models require the Plus plan or above.';
  if (url.includes('/image_generation')) return '\n\nimage-01 requires the Plus plan or above.';
  if (url.includes('/video_generation') || url.includes('/query/video_generation'))
                                         return '\n\nVideo models (Hailuo-2.3 / 2.3-Fast) require the Max plan or above.';
  return '';
}

function upgradeUrl(url?: string): string {
  const host = url?.includes('api.minimax.cn') || url?.includes('api.minimaxi.com')
    ? 'https://platform.minimax.cn'
    : 'https://platform.minimax.io';
  return `${host}/subscribe/token-plan`;
}

/** Per-image failure reasons from an all-failed /v1/images/* response, one line each. */
function imageFailureDetails(body: ApiErrorBody): string | undefined {
  if (!Array.isArray(body.data)) return undefined;
  const items = body.data as Array<{ error?: { code?: string | number; message?: string } } | null>;
  const lines = items.flatMap((item, index) => item?.error
    ? [`Image ${index + 1}${item.error.code !== undefined ? ` (${item.error.code})` : ''}: ${item.error.message ?? 'unknown error'}`]
    : []);
  return lines.length > 0 ? lines.join('\n') : undefined;
}

export function mapApiError(status: number, body: ApiErrorBody, url?: string): CLIError {
  const error = mapApiErrorBase(status, body, url);
  const details = url?.includes('/v1/images/') ? imageFailureDetails(body) : undefined;
  if (!details) return error;
  return new CLIError(error.message, error.exitCode, error.hint ? `${details}\n${error.hint}` : details);
}

function mapApiErrorBase(status: number, body: ApiErrorBody, url?: string): CLIError {
  const apiMsg =
    body.base_resp?.status_msg ||
    body.error?.message ||
    `HTTP ${status}`;

  // /v1/images/* (OpenAI-style) errors put the MiniMax code at the end of the
  // message: "no image generated: all 2 images failed content safety check (1027)".
  // Scoped to that endpoint so other APIs keep their existing classification.
  const trailingCode = url?.includes('/v1/images/')
    ? body.error?.message?.match(/\((\d{4})\)\s*$/)?.[1]
    : undefined;
  const apiCode = body.base_resp?.status_code || body.error?.code
    || (trailingCode ? Number(trailingCode) : undefined);
  const errorType = body.error?.type;

  if (status === 401 || status === 403) {
    return new CLIError(
      `API key rejected (HTTP ${status}).`,
      ExitCode.AUTH,
      'Check status: mmx auth status\nRe-authenticate: mmx auth login',
    );
  }

  if (status === 429) {
    return new CLIError(
      `Rate limit or quota exceeded. ${apiMsg}`,
      ExitCode.QUOTA,
      'Check usage: mmx quota show',
    );
  }

  // 2068: the current plan tier does not include this model (returned as HTTP 402).
  if (apiCode === 2068 && url?.includes('/v1/images/')) {
    return new CLIError(
      `This model is not available on your current plan. ${apiMsg}`,
      ExitCode.QUOTA,
      `Check usage: mmx quota show\nUpgrade plan: ${upgradeUrl(url)}`,
    );
  }

  if (status === 402 || errorType === 'insufficient_balance_error') {
    return new CLIError(
      `Quota or balance exhausted. ${apiMsg}`,
      ExitCode.QUOTA,
      'Check your MiniMax account balance and billing settings.',
    );
  }

  if (status === 408 || status === 504) {
    return new CLIError(
      `Request timed out (HTTP ${status}).`,
      ExitCode.TIMEOUT,
      'Try increasing --timeout or retry later.',
    );
  }

  // The speech-to-text API uses 422 specifically for sensitive audio (1026).
  // Its message language varies, so key off the endpoint + status rather than
  // message text; other endpoints keep the heuristic below.
  if (status === 422 && url?.includes('/speech_to_text')) {
    return new CLIError(
      `Input audio flagged by sensitivity filter${apiMsg ? ` (${apiMsg})` : ''}.`,
      ExitCode.CONTENT_FILTER,
    );
  }

  // The server-side counterpart of the local 50 MB pre-upload check; reached
  // only if the two limits ever disagree.
  if (status === 413 && url?.includes('/speech_to_text')) {
    return new CLIError(
      `Audio file exceeds the speech-to-text size limit (HTTP 413). ${apiMsg}`,
      ExitCode.USAGE,
      'Re-encode to compressed mono audio (e.g. mp3 / aac) or split it into smaller files.',
    );
  }

  const isV2ContentFilter =
    status === 422 &&
    errorType === 'unprocessable_entity_error' &&
    (/sensitive content/i.test(apiMsg) || /(?:^|\D)1026(?:\D|$)/.test(apiMsg));

  // MiniMax content sensitivity filter
  if (apiCode === 1002 || apiCode === 1039 || apiCode === 1026 || isV2ContentFilter) {
    const filterType =
      body.base_resp?.status_msg ||
      body.error?.message ||
      'content sensitivity';
    return new CLIError(
      `Input content flagged by sensitivity filter (${filterType}).`,
      ExitCode.CONTENT_FILTER,
    );
  }

  // MiniMax insufficient quota
  if (apiCode === 1028 || apiCode === 1030) {
    const hint = planHintForUrl(url);
    return new CLIError(
      `Quota exhausted. ${apiMsg}`,
      ExitCode.QUOTA,
      `Check usage: mmx quota show${hint}\nUpgrade plan: ${upgradeUrl(url)}`,
    );
  }

  // MiniMax model not supported by plan
  if (apiCode === 2061) {
    const hint = planHintForUrl(url);
    return new CLIError(
      `This model is not available on your current Token Plan. ${apiMsg}`,
      ExitCode.QUOTA,
      `Check usage: mmx quota show${hint}\nUpgrade plan: ${upgradeUrl(url)}`,
    );
  }

  // output sensitivity (status_code 1027, e.g. "output new_sensitive")
  if (apiCode === 1027 || /output.*sensitive/i.test(apiMsg)) {
    return new CLIError(
      `Output withheld by content moderation (${apiMsg}).`,
      ExitCode.CONTENT_FILTER,
      'Refine your query and try again.',
    );
  }

  return new CLIError(
    `API error: ${apiMsg} (HTTP ${status})`,
    ExitCode.GENERAL,
  );
}
