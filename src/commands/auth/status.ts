import { defineCommand } from '../../command';
import { resolveCredential } from '../../auth/resolver';
import { loadCredentials } from '../../auth/credentials';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import { requestJson } from '../../client/http';
import { quotaEndpoint, usageEndpoint } from '../../client/endpoints';
import { renderUsage } from '../../output/usage';
import { maskToken } from '../../utils/token';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { AccountBalanceResponse, QuotaResponse } from '../../types/api';

export default defineCommand({
  name: 'auth status',
  description: 'Show current authentication state and quota snapshot',
  usage: 'mmx auth status',
  examples: [
    'mmx auth status',
    'mmx auth status --output json',
  ],
  async run(config: Config, _flags: GlobalFlags) {
    try {
      const credential = await resolveCredential(config);
      const format = detectOutputFormat(config.output);

      if (format !== 'text') {
        const result: Record<string, unknown> = {
          method: credential.method,
          source: credential.source,
        };
        if (credential.method === 'oauth') {
          const creds = await loadCredentials();
          if (creds) {
            result.token_expires = creds.expires_at;
            if (creds.account) result.account = creds.account;
          }
        } else {
          result.key = maskToken(credential.token);
          const url = usageEndpoint(config.baseUrl, credential.token);
          const usage = await requestJson<AccountBalanceResponse | QuotaResponse>(config, { url });
          result.usage = usage;
        }
        console.log(formatOutput(result, format));
        return;
      }

      // Text format — rich output
      console.log('Authentication Status:');
      console.log(`  Method: ${credential.method}`);
      console.log(`  Source: ${credential.source}`);

      const token = credential.token;
      console.log(`  Key:    ${maskToken(token)}`);

      if (credential.method === 'oauth') {
        const creds = await loadCredentials();
        if (creds) {
          if (creds.account) console.log(`  Account: ${creds.account}`);
          const expiresAt = new Date(creds.expires_at);
          const minutesLeft = Math.round((expiresAt.getTime() - Date.now()) / 60000);
          console.log(`  Expires in: ${minutesLeft} minutes`);
        }
      } else {
        const url = usageEndpoint(config.baseUrl, token);
        try {
          const response = await requestJson<AccountBalanceResponse | QuotaResponse>(config, { url });
          renderUsage(response, config, token);
        } catch (e) {
          console.log(`  Quota fetch failed: ${(e as Error).message}`);
        }
        return;
      }

      // Fetch quota snapshot
      process.stderr.write('Fetching quota snapshot...\n');
      try {
        const url = quotaEndpoint(config.baseUrl);
        const quota = await requestJson<QuotaResponse>(config, { url, method: 'GET' });
        renderUsage(quota, config);
      } catch (e) {
        console.log(`  Quota fetch failed: ${(e as Error).message}`);
      }

    } catch {
      const format = detectOutputFormat(config.output);
      const result = {
        authenticated: false,
        message: 'Not authenticated.',
        hint: 'Run: mmx auth login\nOr set $MINIMAX_API_KEY',
      };
      console.log(formatOutput(result, format));
    }
  },
});
