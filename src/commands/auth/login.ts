import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { saveCredentials } from '../../auth/credentials';
import { startBrowserFlow, startDeviceCodeFlow } from '../../auth/oauth';
import { requestJson } from '../../client/http';
import { quotaEndpoint } from '../../client/endpoints';
import { renderQuotaTable } from '../../output/quota-table';

import { getConfigPath } from '../../config/paths';
import { readConfigFile, writeConfigFile } from '../../config/loader';
import { REGIONS, type Region } from '../../config/schema';
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
    { flag: '--no-browser', description: 'Use device-code flow instead of browser' },
  ],
  examples: [
    'mmx auth login',
    'mmx auth login --no-browser',
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

      // Validate key by probing all regions in parallel.
      // A CN key fails against the global endpoint (and vice versa), so we must
      // try every region to avoid false "validation failed" errors.
      if (!config.dryRun) {
        process.stderr.write('Testing key... ');

        const regions = Object.keys(REGIONS) as Region[];
        const results = await Promise.all(
          regions.map(async (region) => {
            const baseUrl = REGIONS[region];
            try {
              const testConfig = { ...config, apiKey: key, baseUrl };
              await requestJson<QuotaResponse>(testConfig, {
                url: quotaEndpoint(baseUrl),
              });
              return { region, ok: true as const, error: '' };
            } catch (err) {
              return { region, ok: false as const, error: err instanceof Error ? err.message : String(err) };
            }
          }),
        );

        const match = results.find((r) => r.ok);
        if (!match) {
          const details = results.map((r) => `${r.region}: ${r.error}`).join('; ');
          throw new CLIError(
            `API key validation failed: ${details}`,
            ExitCode.AUTH,
            'Run with --verbose for request details.',
          );
        }

        process.stderr.write(`Valid (${match.region})\n`);

        config.region = match.region;
        config.baseUrl = REGIONS[match.region];

        const existing = readConfigFile() as Record<string, unknown>;
        existing.api_key = key;
        existing.region = match.region;
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

    let tokens;
    if (flags.noBrowser) {
      tokens = await startDeviceCodeFlow();
    } else {
      tokens = await startBrowserFlow();
    }

    const creds: CredentialFile = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      token_type: 'Bearer',
    };

    await saveCredentials(creds);
    process.stderr.write('Logged in successfully.\n');
    process.stderr.write('Credentials saved to ~/.mmx/credentials.json\n');

    await showQuotaAfterLogin({ ...config, apiKey: creds.access_token });
  },
});
