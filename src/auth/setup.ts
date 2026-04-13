import type { Config } from '../config/schema';
import { readConfigFile, writeConfigFile } from '../config/loader';
import { promptText, promptConfirm } from '../utils/prompt';
import { isInteractive } from '../utils/env';
import { maskToken } from '../utils/token';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import { startDeviceCodeFlow, type OAuthConfig } from './oauth';
import { saveCredentials, loadCredentials } from './credentials';
import type { CredentialFile } from './types';

export async function ensureAuth(config: Config): Promise<void> {
  if (config.apiKey || config.fileApiKey) return;

  // Check existing OAuth credentials
  const existingOAuth = await loadCredentials();
  if (existingOAuth) return;

  const envKey = process.env.MINIMAX_API_KEY;
  let key: string | undefined;

  if (envKey) {
    if (!isInteractive({ nonInteractive: config.nonInteractive })) {
      key = envKey;
    } else {
      const use = await promptConfirm({
        message: `Found MINIMAX_API_KEY in environment (${maskToken(envKey)}). Save it to config file?`,
      });
      if (use) key = envKey;
    }
  }

  if (!key) {
    if (!isInteractive({ nonInteractive: config.nonInteractive })) {
      throw new CLIError(
        'No credentials found.',
        ExitCode.AUTH,
        'Log in:        mmx auth login\nPass directly:  --api-key sk-xxxxx',
      );
    }

    const { select } = await import('@clack/prompts');
    const method = await select({
      message: 'How would you like to authenticate?',
      options: [
        { value: 'oauth', label: 'Log in with MiniMax account (OAuth)' },
        { value: 'api-key', label: 'Enter API key manually' },
      ],
    });

    if (typeof method === 'symbol') {
      // User pressed Ctrl+C
      throw new CLIError('Authentication cancelled.', ExitCode.AUTH);
    }

    if (method === 'oauth') {
      const oauthConfig: OAuthConfig = {
        clientId: '659cf4c1-615c-45f6-a5f6-4bf15eb476e5',
        clientName: 'MiniMax CLI',
        authorizationUrl: `${config.platformHost}/oauth-authorize`,
        tokenUrl: `${config.oauthApiHost}/oauth2/token`,
        deviceCodeUrl: `${config.oauthApiHost}/oauth2/device/code`,
        scopes: ['openid', 'profile', 'coding_plan'],
        callbackPort: 18991,
      };
      const tokens = await startDeviceCodeFlow(oauthConfig);
      const creds: CredentialFile = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(tokens.expired_in).toISOString(),
        token_type: 'Bearer',
        resource_url: tokens.resource_url,
      };
      await saveCredentials(creds);
      process.stderr.write('Logged in successfully.\n');
      return;
    }

    // api-key method
    const input = await promptText({ message: 'Enter your MiniMax API key:' });
    if (!input) throw new CLIError('API key is required.', ExitCode.AUTH);
    key = input;
  }

  const data = { ...(readConfigFile() as Record<string, unknown>), api_key: key };
  await writeConfigFile(data);
  config.fileApiKey = key;

  const path = config.configPath ?? '~/.mmx/config.json';
  process.stderr.write(`API key saved to ${path}\n`);
}
