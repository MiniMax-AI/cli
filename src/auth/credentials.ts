import { readConfigFile, writeConfigFile } from '../config/loader';
import type { CredentialFile } from './types';

/**
 * OAuth credentials live inside the user's main config file
 * (`~/.mmx/config.json`) under the `oauth` subobject. This keeps a
 * single source of truth for all CLI state.
 */

export async function loadCredentials(): Promise<CredentialFile | null> {
  const cfg = readConfigFile();
  if (!cfg.oauth) return null;
  return {
    access_token: cfg.oauth.access_token,
    refresh_token: cfg.oauth.refresh_token,
    expires_at: cfg.oauth.expires_at,
    token_type: cfg.oauth.token_type,
    resource_url: cfg.oauth.resource_url,
    account: cfg.oauth.account,
  };
}

export async function saveCredentials(creds: CredentialFile): Promise<void> {
  const existing = readConfigFile() as Record<string, unknown>;
  existing.oauth = creds;
  await writeConfigFile(existing);
}

export async function clearCredentials(): Promise<void> {
  const existing = readConfigFile() as Record<string, unknown>;
  if (!('oauth' in existing)) return;
  delete existing.oauth;
  await writeConfigFile(existing);
}
