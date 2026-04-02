import type { Config } from '../config/schema';
import type { ResolvedCredential } from './types';
import { loadCredentials } from './credentials';
import { ensureFreshToken } from './refresh';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';

export async function resolveCredential(config: Config): Promise<ResolvedCredential> {
  // 1. --api-key flag
  if (config.apiKey) {
    return { token: config.apiKey, method: 'api-key', source: 'flag' };
  }

  // 2. OAuth credentials file
  const oauth = await loadCredentials();
  if (oauth) {
    const token = await ensureFreshToken(oauth);
    return { token, method: 'oauth', source: 'credentials.json' };
  }

  // 3. API key from config file
  if (config.fileApiKey) {
    return { token: config.fileApiKey, method: 'api-key', source: 'config.json' };
  }

  throw new CLIError(
    'No credentials found.',
    ExitCode.AUTH,
    'Log in:        minimax auth login\nPass directly:  --api-key sk-xxxxx',
  );
}
