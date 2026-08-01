import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { pickAuthMethod, pickOAuthRegion, runOAuthLogin } from '../../auth/setup';
import { requestJson } from '../../client/http';
import { quotaEndpoint, usageEndpoint } from '../../client/endpoints';
import { renderUsage } from '../../output/usage';
import { detectRegion } from '../../config/detect-region';

import { getConfigPath } from '../../config/paths';
import { readConfigFile, writeConfigFile } from '../../config/loader';
import { isInteractive } from '../../utils/env';
import { maskToken } from '../../utils/token';
import type { Config, Region } from '../../config/schema';
import { REGIONS } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { AccountBalanceResponse, QuotaModelRemain } from '../../types/api';

interface QuotaApiResponse {
  model_remains: QuotaModelRemain[];
}

function isNetworkUnavailable(error: unknown): boolean {
  if (error instanceof CLIError) {
    return error.exitCode === ExitCode.NETWORK || error.exitCode === ExitCode.TIMEOUT;
  }

  if (!(error instanceof Error)) return false;

  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;

  const message = error.message.toLowerCase();
  const code = 'code' in error ? String(error.code).toLowerCase() : '';
  return (error instanceof TypeError && message === 'fetch failed')
    || message.includes('failed to fetch')
    || message.includes('unable to connect')
    || message.includes('connection refused')
    || message.includes('econnrefused')
    || message.includes('connection reset')
    || message.includes('econnreset')
    || message.includes('network error')
    || message.includes('enotfound')
    || message.includes('getaddrinfo')
    || message.includes('proxy')
    || message.includes('socket')
    || message.includes('etimedout')
    || code === 'connectionrefused'
    || code === 'econnrefused'
    || code === 'econnreset'
    || code === 'enotfound'
    || code === 'etimedout';
}

async function showQuotaAfterLogin(config: Config): Promise<void> {
  try {
    const apiKey = config.apiKey || config.fileApiKey;
    if (apiKey && apiKey.startsWith('sk-api-')) {
      const url = usageEndpoint(config.baseUrl, apiKey);
      const response = await requestJson<AccountBalanceResponse>(config, { url });
      renderUsage(response, config, apiKey);
      return;
    }

    const url = quotaEndpoint(config.baseUrl);
    const response = await requestJson<QuotaApiResponse>(config, { url });
    renderUsage(response, config);
  } catch {
    // Non-fatal — login succeeded, quota display is best-effort
  }
}

/**
 * Mirrors the `mmx` (no-args) dashboard: prints the help panel
 * followed by the quota snapshot. Used right after a successful
 * login so the user lands somewhere useful instead of an empty prompt.
 */
async function showDashboardAfterLogin(config: Config): Promise<void> {
  const { registry } = await import('../../registry');
  registry.printHelp([], process.stderr, config.region);
  await showQuotaAfterLogin(config);
}

export default defineCommand({
  name: 'auth login',
  description: 'Authenticate via OAuth or API key',
  usage: 'mmx auth login [--api-key <key>] [--recommend] [--region=global|cn]',
  options: [
    { flag: '--api-key <key>', description: 'Skip the menu and save this API key directly' },
    { flag: '--recommend',     description: 'Skip the menu, go straight to OAuth (combine with --region= to skip the region picker)' },
  ],
  examples: [
    'mmx auth login',
    'mmx auth login --api-key sk-cp-xxxxx',
    'mmx auth login --recommend',
    'mmx auth login --recommend --region=global',
    'mmx auth login --recommend --region=cn',
  ],
  async run(config: Config, flags: GlobalFlags) {
    const envKey = process.env.MINIMAX_API_KEY;
    if (envKey && !flags.apiKey) {
      const masked = maskToken(envKey);
      if (isInteractive({ nonInteractive: config.nonInteractive })) {
        const { confirm, isCancel } = await import('@clack/prompts');
        const proceed = await confirm({
          message: `MINIMAX_API_KEY is set (${masked}). Configure persistent credentials anyway?`,
          initialValue: false,
        });
        if (isCancel(proceed) || !proceed) {
          process.stdout.write('Login skipped. Using environment variable.\n');
          process.exit(0);
        }
      } else {
        process.stderr.write(`Warning: MINIMAX_API_KEY is already set in environment.\n`);
      }
    }

    if (flags.apiKey) {
      await loginWithApiKey(config, flags.apiKey as string, flags.region as Region | undefined);
      return;
    }

    if (config.dryRun) {
      console.log('Would prompt for auth method (oauth-global, oauth-cn, api-key).');
      return;
    }

    if (!isInteractive({ nonInteractive: config.nonInteractive })) {
      throw new CLIError(
        '--api-key is required in non-interactive mode.',
        ExitCode.USAGE,
        'mmx auth login --api-key sk-xxxxx',
      );
    }

    // --recommend: skip the 3-option menu, go straight to OAuth.
    // With --region, skip the region picker too.
    if (flags.recommend) {
      const region = (flags.region as Region) || await pickOAuthRegion();
      await completeOAuthLogin(config, region);
      return;
    }

    const choice = await pickAuthMethod();
    if (choice === 'api-key') {
      const { text, isCancel } = await import('@clack/prompts');
      const key = await text({
        message: 'Paste your MiniMax API key:',
        validate: (v) => (v && v.length > 0 ? undefined : 'API key cannot be empty.'),
      });
      if (isCancel(key)) throw new CLIError('Authentication cancelled.', ExitCode.AUTH);
      await loginWithApiKey(config, key as string, flags.region as Region | undefined);
      return;
    }

    const region: Region = (flags.region as Region) || (choice === 'oauth-cn' ? 'cn' : 'global');
    await completeOAuthLogin(config, region);
  },
});

async function completeOAuthLogin(config: Config, region: Region): Promise<void> {
  await runOAuthLogin(region);

  // Reload so the OAuth subobject (and any resource_url override) is picked up.
  const fresh = readConfigFile();
  const cfg: Config = {
    ...config,
    region,
    baseUrl: fresh.oauth?.resource_url || REGIONS[region],
  };
  await showDashboardAfterLogin(cfg);
}

async function loginWithApiKey(
  config: Config,
  key: string,
  explicitRegion?: Region,
): Promise<void> {
  if (config.dryRun) {
    console.log('Would validate and save API key.');
    return;
  }

  // An explicit region is authoritative. Otherwise probe both regions and fail
  // closed if neither can be confirmed; never persist a guessed fallback.
  const detected = explicitRegion ?? await detectRegion(key);
  const cfg: Config = { ...config, region: detected, baseUrl: REGIONS[detected], apiKey: key };
  const url = usageEndpoint(cfg.baseUrl, key);

  // Verify the selected region actually authorizes the appropriate usage endpoint.
  try {
    await requestJson<QuotaApiResponse | AccountBalanceResponse>(cfg, { url });
  } catch (error) {
    if (error instanceof CLIError && error.exitCode === ExitCode.AUTH) {
      const validationHint = key.startsWith('sk-api-')
        ? 'Check that your key is valid and belongs to an API secret key.'
        : 'Check that your key is valid and belongs to a Token Plan.';
      throw new CLIError(
        'API key validation failed.',
        ExitCode.AUTH,
        validationHint,
      );
    }

    if (!explicitRegion) throw error;

    const validationFailure = isNetworkUnavailable(error)
      ? `the ${detected} API endpoint is unreachable`
      : `the ${detected} API endpoint returned an inconclusive response`;
    process.stderr.write(
      `Warning: Could not validate the API key because ${validationFailure}.\n` +
      `Saving the explicitly selected region "${detected}". Requests may fail until validation succeeds.\n`,
    );
  }

  // OAuth and api_key are mutually exclusive — drop any stale oauth block.
  const existing = readConfigFile() as Record<string, unknown>;
  delete existing.oauth;
  existing.api_key = key;
  existing.region = detected;
  await writeConfigFile(existing);
  process.stderr.write(`API key saved to ${getConfigPath()}\n`);

  await showDashboardAfterLogin(cfg);
}
