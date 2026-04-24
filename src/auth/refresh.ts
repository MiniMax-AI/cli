import type { OAuthTokens, CredentialFile } from "./types";
import { saveCredentials } from "./credentials";
import { CLIError } from "../errors/base";
import { ExitCode } from "../errors/codes";

// OAuth config — endpoints TBD pending MiniMax OAuth documentation
const TOKEN_URL = "https://api.minimax.io/v1/oauth/token";

const MAX_REFRESH_RETRIES = 2;
const RETRY_DELAY_MS = 500;

export async function refreshAccessToken(
  refreshToken: string,
): Promise<OAuthTokens> {
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= MAX_REFRESH_RETRIES; attempt++) {
    if (attempt > 0) {
      // Exponential backoff before retry
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
    }

    let res: Response;
    try {
      res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
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
      continue; // retry
    }

    if (!res.ok) {
      // 4xx errors won't recover with retry
      if (res.status >= 400 && res.status < 500) {
        throw new CLIError(
          "OAuth session expired and could not be refreshed.",
          ExitCode.AUTH,
          "Re-authenticate: mmx auth login",
        );
      }
      lastErr = new Error(`Token refresh failed: HTTP ${res.status}`);
      continue; // retry 5xx errors
    }

    const data = (await res.json()) as OAuthTokens;
    return data;
  }

  // All retries exhausted
  throw new CLIError(
    `Token refresh failed after ${MAX_REFRESH_RETRIES + 1} attempts: ${lastErr?.message}`,
    ExitCode.AUTH,
    "Check your network connection.\nRe-authenticate: mmx auth login",
  );
}

export async function ensureFreshToken(creds: CredentialFile): Promise<string> {
  const expiresAt = new Date(creds.expires_at).getTime();
  const bufferMs = 5 * 60 * 1000; // 5 minutes

  if (Date.now() < expiresAt - bufferMs) {
    return creds.access_token;
  }

  // Token expired or about to expire — refresh
  const tokens = await refreshAccessToken(creds.refresh_token);

  const updated: CredentialFile = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    token_type: "Bearer",
    account: creds.account,
  };

  await saveCredentials(updated);
  return updated.access_token;
}
