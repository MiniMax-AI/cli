import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { saveCredentials } from '../../auth/credentials';
import { startDeviceCodeFlow, type OAuthConfig } from '../../auth/oauth';
import { requestJson } from '../../client/http';
import { quotaEndpoint } from '../../client/endpoints';
import { renderQuotaTable } from '../../output/quota-table';

import { getConfigPath } from '../../config/paths';
import { readConfigFile, writeConfigFile } from '../../config/loader';
import { isInteractive } from '../../utils/env';
import { maskToken } from '../../utils/token';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { CredentialFile } from '../../auth/types';
import type { QuotaResponse, QuotaModelRemain } from '../../types/api';

interface QuotaApiResponse {
  model_remains: QuotaModelRemain[];
}

async function showQuotaAfterLogin(config: Config): Promise<void> {
  try {
    const url = quotaEndpoint(config.baseUrl);
    const response = await requestJson<QuotaApiResponse>(config, { url });
    renderQuotaTable(response.model_remains || [], config);
  } catch {
    // Non-fatal — login succeeded, quota display is best-effort
  }
}

export default defineCommand({
  name: 'auth login',
  description: 'Authenticate via OAuth or API key',
  usage: 'mmx auth login [--method oauth|api-key] [--api-key <key>] [--no-browser]',
  options: [
    { flag: '--method <method>', description: 'Auth method: oauth (default), api-key' },
    { flag: '--api-key <key>', description: 'API key to store' },
  ],
  examples: [
    'mmx auth login',
    'mmx auth login --api-key sk-xxxxx',
    'mmx auth login --method api-key --api-key sk-xxxxx',
  ],
  async run(config: Config, flags: GlobalFlags) {
    const envKey = process.env.MINIMAX_API_KEY;
    if (envKey && !flags.apiKey) {
      const maskedEnvKey = maskToken(envKey);
      if (isInteractive({ nonInteractive: config.nonInteractive })) {
        const { confirm } = await import('@clack/prompts');
        const proceed = await confirm({
          message: `Detected MINIMAX_API_KEY in environment (${maskedEnvKey}).\nYou are already authenticated via env.\nDo you still want to configure local persistent credentials?`,
          initialValue: false,
        });
        if (!proceed) {
          process.stdout.write('Login skipped. Using environment variables.\n');
          process.exit(0);
        }
      } else {
        process.stderr.write(`Warning: MINIMAX_API_KEY is already set in environment.\n`);
      }
    }

    const method = flags.apiKey ? 'api-key' : (flags.method as string) || 'oauth';

    if (method === 'api-key') {
      const key = (flags.apiKey as string) || config.apiKey;
      if (!key) {
        throw new CLIError(
          '--api-key is required when using --method api-key.',
          ExitCode.USAGE,
          'mmx auth login --api-key sk-xxxxx',
        );
      }

      // Validate the key by calling quota endpoint
      if (!config.dryRun) {
        process.stderr.write('Testing key... ');
        try {
          const testConfig = { ...config, apiKey: key };
          await requestJson<QuotaResponse>(testConfig, {
            url: quotaEndpoint(testConfig.baseUrl),
          });
          process.stderr.write('Valid\n');
        } catch {
          throw new CLIError(
            'API key validation failed.',
            ExitCode.AUTH,
            'Check that your key is valid and belongs to a Token Plan.',
          );
        }

        // Store key in config.json
        const existing = readConfigFile() as Record<string, unknown>;
        existing.api_key = key;
        await writeConfigFile(existing);
        process.stderr.write(`API key saved to ${getConfigPath()}\n`);

        await showQuotaAfterLogin({ ...config, apiKey: key });
      } else {
        console.log('Would validate and save API key.');
      }
      return;
    }

    // OAuth flow
    if (config.dryRun) {
      console.log('Would start OAuth login flow.');
      return;
    }

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
      expires_at: new Date(tokens.expired_in).toISOString(), // expired_in is Unix timestamp (ms)
      token_type: 'Bearer',
      resource_url: tokens.resource_url,
    };

    await saveCredentials(creds);
    process.stderr.write('Logged in successfully.\n');
    process.stderr.write('Credentials saved to ~/.mmx/credentials.json\n');

    await showQuotaAfterLogin({ ...config, apiKey: creds.access_token });
  },
});
