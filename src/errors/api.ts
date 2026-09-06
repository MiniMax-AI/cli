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
  const host = url?.includes('minimaxi.com') ? 'https://platform.minimaxi.com' : 'https://platform.minimax.io';
  return `${host}/subscribe/token-plan`;
}

export function mapApiError(status: number, body: ApiErrorBody, url?: string): CLIError {
  const apiMsg =
    body.base_resp?.status_msg ||
    body.error?.message ||
    `HTTP ${status}`;

  const apiCode = body.base_resp?.status_code || body.error?.code;
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
