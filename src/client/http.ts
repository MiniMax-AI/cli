import type { Config } from '../config/schema';
import type { ApiErrorBody } from '../errors/api';
import { resolveCredential } from '../auth/resolver';
import { mapApiError } from '../errors/api';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';

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

// Printed once per process invocation to avoid repeating on every request.
let statusBarPrinted = false;

export async function request(
  config: Config,
  opts: RequestOpts,
): Promise<Response> {
  const isFormData =
    typeof FormData !== 'undefined' && opts.body instanceof FormData;

  const version = process.env.CLI_VERSION ?? '0.3.1';
  const headers: Record<string, string> = {
    'User-Agent': `minimax-cli/${version}`,
    ...opts.headers,
  };

  // Only set Content-Type for non-FormData bodies; FormData lets fetch set the multipart boundary automatically
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
      process.stderr.write(`> ${opts.method || 'GET'} ${opts.url}\n`);
      process.stderr.write(`> Auth: ${credential.token.slice(0, 8)}...\n`);
    }

    // ANSI 真彩色 (24-bit) 与基础排版
    if (!config.quiet && !statusBarPrinted && process.stderr.isTTY) {
      statusBarPrinted = true;
      const reset = '\x1b[0m';
      const dim = '\x1b[2m';
      const bold = '\x1b[1m'; // 新增加粗效果

      // 从 MiniMax Logo/品牌视觉提取的 RGB 颜色
      const mmBlue = '\x1b[38;2;43;82;255m';    // 主品牌色：MiniMax 科技蓝 (#2B52FF)
      const mmPurple = '\x1b[38;2;147;51;234m'; // 辅助品牌色：活力紫 (#9333EA)
      const mmCyan = '\x1b[38;2;6;184;212m';   // 点缀色：青色 (#06B8D4)
      const mmPink = '\x1b[38;2;236;72;153m';   // 点缀色：粉红 (#EC4899)

      // 提取 Region (根据 baseUrl 推断)
      const region = config.baseUrl.includes('minimaxi.com') ? 'CN' : 'Global';

      // 提取脱敏的 Key
      const token = credential.token;
      const maskedKey = token.length > 8 ? `${token.slice(0, 4)}...${token.slice(-4)}` : '***';

      // 尝试从 body 中提取 Model
      let modelStr = '';
      if (opts.body && typeof opts.body === 'object' && 'model' in opts.body) {
        modelStr = ` ${dim}|${reset} ${dim}Model:${reset} ${mmPurple}${(opts.body as any).model}${reset}`;
      }

      // 打印带有完整 MINIMAX 标识的状态栏
      process.stderr.write(
        `${bold}${mmBlue}MINIMAX${reset} ` +
        `${dim}Region:${reset} ${mmCyan}${region}${reset} ` +
        `${dim}|${reset} ` +
        `${dim}Key:${reset} ${mmPink}${maskedKey}${reset}` +
        `${modelStr}\n`
      );
    }
  }

  const timeoutMs = (opts.timeout || config.timeout) * 1000;

  const res = await fetch(opts.url, {
    method: opts.method || 'GET',
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
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      // Response body is not JSON
    }
    throw mapApiError(res.status, body, opts.url);
  }

  return res;
}

export async function requestJson<T>(config: Config, opts: RequestOpts): Promise<T> {
  const res = await request(config, opts);
  const data = (await res.json()) as T & { base_resp?: { status_code?: number; status_msg?: string } };

  // MiniMax APIs return HTTP 200 with error details in base_resp
  if (data.base_resp && data.base_resp.status_code && data.base_resp.status_code !== 0) {
    throw mapApiError(200, { base_resp: data.base_resp }, opts.url);
  }

  return data;
}
