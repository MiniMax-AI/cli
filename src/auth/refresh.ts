import type { OAuthTokens, CredentialFile } from "./types";
import { saveCredentials } from "./credentials";
import { CLIError } from "../errors/base";
import { ExitCode } from "../errors/codes";

const DEFAULT_TOKEN_URL = 'https://account.minimax.io/oauth2/token';
const DEFAULT_CLIENT_ID = '659cf4c1-615c-45f6-a5f6-4bf15eb476e5';

const MAX_REFRESH_RETRIES = 2;
const RETRY_DELAY_MS = 500;

export async function refreshAccessToken(
  refreshToken: string,
  tokenUrl: string = DEFAULT_TOKEN_URL,
  clientId: string = DEFAULT_CLIENT_ID,
): Promise<OAuthTokens> {
  const lane = process.env.BEDROCK_LANE;
  const extraHeaders: Record<string, string> = lane ? { bedrock_lane: lane } : {};
  if (process.env.X_USER_PRE) extraHeaders['X-User-Pre'] = 'true';

  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= MAX_REFRESH_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
    }

    let res: Response;
    try {
      res = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...extraHeaders },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: clientId,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      const isTimeout =
        err instanceof Error &&
        (err.name === "AbortError" ||
          err.name === "TimeoutError" ||
          err.message.includes("timed out"));
      lastErr = new Error(
        isTimeout
          ? "Token refresh timed out — auth server did not respond within 10 s."
          : `Token refresh failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    if (!res.ok) {
      if (res.status >= 400 && res.status < 500) {
        throw new CLIError(
          "OAuth session expired and could not be refreshed.",
          ExitCode.AUTH,
          "Re-authenticate: mmx auth login",
        );
      }
      lastErr = new Error(`Token refresh failed: HTTP ${res.status}`);
      continue;
    }

    const body = (await res.json()) as {
      status: string;
      access_token?: string;
      refresh_token?: string;
      expired_in?: number;
      resource_url?: string;
    };

    if (body.status !== 'success' || !body.access_token) {
      throw new CLIError(
        'OAuth refresh failed.',
        ExitCode.AUTH,
        'Re-authenticate: mmx auth login',
      );
    }

    return {
      access_token: body.access_token,
      refresh_token: body.refresh_token ?? refreshToken,
      expired_in: body.expired_in ?? 0,
      token_type: 'Bearer',
      resource_url: body.resource_url,
    };
  }

  throw new CLIError(
    `Token refresh failed after ${MAX_REFRESH_RETRIES + 1} attempts: ${lastErr?.message}`,
    ExitCode.AUTH,
    "Check your network connection.\nRe-authenticate: mmx auth login",
  );
}

export async function ensureFreshToken(
  creds: CredentialFile,
  tokenUrl?: string,
  clientId?: string,
): Promise<string> {
  const expiresAt = new Date(creds.expires_at).getTime();
  const bufferMs = 5 * 60 * 1000;

  if (Date.now() < expiresAt - bufferMs) {
    return creds.access_token;
  }

  const tokens = await refreshAccessToken(creds.refresh_token, tokenUrl, clientId);

  const updated: CredentialFile = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: new Date(tokens.expired_in).toISOString(), // expired_in is Unix timestamp (ms)
    token_type: 'Bearer',
    resource_url: tokens.resource_url ?? creds.resource_url,
    account: creds.account,
  };

  await saveCredentials(updated);
  return updated.access_token;
}
