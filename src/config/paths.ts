import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR_NAME = '.mmx';

export function getConfigDir(): string {
  return join(homedir(), CONFIG_DIR_NAME);
}

export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

export async function ensureConfigDir(): Promise<void> {
  const dir = getConfigDir();
  const fs = await import('fs/promises');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
}
