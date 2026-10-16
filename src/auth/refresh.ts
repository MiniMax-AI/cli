import { resolve } from 'path';
import type { CredentialFile } from './types';
import type { Region } from '../config/schema';
import { OAUTH_HOSTS } from '../config/schema';
import { getConfigPath } from '../config/paths';
import { saveCredentials } from './credentials';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';

const CLIENT_ID = '659cf4c1-615c-45f6-a5f6-4bf15eb476e5';
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 10_000;
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const pendingRefreshes = new Map<string, Promise<string>>();

interface RefreshResponse {
  base_resp?: { status_code: number; status_msg?: string };
  status: string;
  access_token?: string;
  refresh_token?: string;
  expired_in?: number;  // absolute Unix ms
  resource_url?: string;
}

/**
 * POST /oauth2/token with grant_type=refresh_token. Retries 5xx /
 * network errors up to MAX_RETRIES times; gives up immediately on 4xx.
 */
export async function refreshAccessToken(
  refreshToken: string,
  region: Region = 'global',
): Promise<{ access_token: string; refresh_token: string; expires_at: string; resource_url?: string }> {
  const tokenUrl = `${OAUTH_HOSTS[region]}/oauth2/token`;
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));

    let res: Response;
    try {
      res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: CLIENT_ID,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const isTimeout = err instanceof Error
        && (err.name === 'AbortError' || err.name === 'TimeoutError' || err.message.includes('timed out'));
      lastErr = new Error(
        isTimeout
          ? 'Token refresh timed out — auth server did not respond within 10 s.'
          : `Token refresh failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    if (!res.ok) {
      if (res.status >= 400 && res.status < 500) {
        throw new CLIError(
          'OAuth session expired and could not be refreshed.',
          ExitCode.AUTH,
          'Re-authenticate: mmx auth login',
        );
      }
      lastErr = new Error(`Token refresh failed: HTTP ${res.status}`);
      continue;
    }

    const body = (await res.json()) as RefreshResponse;
    if (body.status !== 'success' || !body.access_token) {
      throw new CLIError(
        `OAuth refresh failed: ${body.status}.`,
        ExitCode.AUTH,
        'Re-authenticate: mmx auth login',
      );
    }
    return {
      access_token: body.access_token,
      refresh_token: body.refresh_token ?? refreshToken,
      expires_at: new Date(body.expired_in ?? Date.now()).toISOString(),
      resource_url: body.resource_url,
    };
  }

  throw new CLIError(
    `Token refresh failed after ${MAX_RETRIES + 1} attempts: ${lastErr?.message}`,
    ExitCode.AUTH,
    'Check your network connection.\nRe-authenticate: mmx auth login',
  );
}

/**
 * Returns a valid access token for the given credentials, refreshing
 * (and persisting) the stored token if it expires within 5 minutes.
 */
export async function ensureFreshToken(creds: CredentialFile): Promise<string> {
  const expiresAt = new Date(creds.expires_at).getTime();
  if (Date.now() < expiresAt - REFRESH_BUFFER_MS) return creds.access_token;

  const path = resolve(getConfigPath());
  const key = JSON.stringify([path, creds.region ?? 'global', creds.refresh_token]);
  const existing = pendingRefreshes.get(key);
  if (existing) return existing;

  // Share persistence as well as the request: waiters need the rotated token on disk.
  const pending = (async () => {
    const fresh = await refreshAccessToken(creds.refresh_token, creds.region ?? 'global');
    const updated: CredentialFile = {
      access_token: fresh.access_token,
      refresh_token: fresh.refresh_token,
      expires_at: fresh.expires_at,
      region: creds.region,
      resource_url: fresh.resource_url ?? creds.resource_url,
      account: creds.account,
    };
    await saveCredentials(updated, path);
    return updated.access_token;
  })();
  pendingRefreshes.set(key, pending);
  try {
    return await pending;
  } finally {
    pendingRefreshes.delete(key);
  }
}
