import type { OAuthTokens, CredentialFile } from './types';
import type { Region } from '../config/schema';
import { saveCredentials } from './credentials';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';

const TOKEN_URLS: Record<Region, string> = {
  global: 'https://api.minimax.io/v1/oauth/token',
  cn: 'https://api.minimaxi.com/v1/oauth/token',
} as const;

export async function refreshAccessToken(
  refreshToken: string,
  region: Region = 'global',
): Promise<OAuthTokens> {
  const tokenUrl = TOKEN_URLS[region];
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    throw new CLIError(
      'OAuth session expired and could not be refreshed.',
      ExitCode.AUTH,
      'Re-authenticate: mmx auth login',
    );
  }

  const data = (await res.json()) as OAuthTokens;
  return data;
}

export async function ensureFreshToken(creds: CredentialFile): Promise<string> {
  const expiresAt = new Date(creds.expires_at).getTime();
  const bufferMs = 5 * 60 * 1000; // 5 minutes

  if (Date.now() < expiresAt - bufferMs) {
    return creds.access_token;
  }

  // Token expired or about to expire — refresh
  const region = (creds.region as Region) || 'global';
  const tokens = await refreshAccessToken(creds.refresh_token, region);

  const updated: CredentialFile = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    token_type: 'Bearer',
    account: creds.account,
  };

  await saveCredentials(updated);
  return updated.access_token;
}
