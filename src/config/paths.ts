import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR_NAME = '.minimax';

export function getConfigDir(): string {
  return join(homedir(), CONFIG_DIR_NAME);
}

export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

export function getLegacyConfigPath(): string {
  return join(getConfigDir(), 'config.yaml');
}

export function getCredentialsPath(): string {
  return join(getConfigDir(), 'credentials.json');
}

export async function ensureConfigDir(): Promise<void> {
  const dir = getConfigDir();
  const fs = await import('fs/promises');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
}
