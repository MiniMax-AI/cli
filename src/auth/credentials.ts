import { readFileSync, writeFileSync, unlinkSync, existsSync, statSync } from 'fs';
import { getCredentialsPath, ensureConfigDir } from '../config/paths';
import type { CredentialFile } from './types';

export async function loadCredentials(): Promise<CredentialFile | null> {
  const path = getCredentialsPath();
  if (!existsSync(path)) return null;

  try {
    checkPermissions(path);
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw) as CredentialFile;
    if (!data.access_token || !data.refresh_token) return null;
    return data;
  } catch (err) {
    const e = err as Error;
    if (e instanceof SyntaxError || e.message.includes('JSON')) {
      process.stderr.write(`Warning: credentials file is corrupted. Run 'minimax auth logout' to reset.\n`);
    }
    return null;
  }
}

export async function saveCredentials(creds: CredentialFile): Promise<void> {
  await ensureConfigDir();
  const path = getCredentialsPath();
  writeFileSync(path, JSON.stringify(creds, null, 2) + '\n', { mode: 0o600 });
}

export async function clearCredentials(): Promise<void> {
  const path = getCredentialsPath();
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

function checkPermissions(path: string): void {
  try {
    const stat = statSync(path);
    const mode = stat.mode & 0o777;
    if (mode !== 0o600) {
      process.stderr.write(
        `Warning: ${path} has permissions ${mode.toString(8)}, expected 600.\n`,
      );
    }
  } catch {
    // Ignore permission check errors on platforms that don't support it
  }
}
