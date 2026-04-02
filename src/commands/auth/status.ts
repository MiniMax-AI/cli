import { defineCommand } from '../../command';
import { resolveCredential } from '../../auth/resolver';
import { loadCredentials } from '../../auth/credentials';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import { requestJson } from '../../client/http';
import { quotaEndpoint } from '../../client/endpoints';
import { renderQuotaTable } from '../../output/quota-table';
import { maskToken } from '../../utils/token';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { QuotaResponse } from '../../types/api';

export default defineCommand({
  name: 'auth status',
  description: 'Show current authentication state and quota snapshot',
  usage: 'minimax auth status',
  examples: [
    'minimax auth status',
    'minimax auth status --output json',
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
      }

      // Fetch quota snapshot
      process.stderr.write('Fetching quota snapshot...\n');
      try {
        const url = quotaEndpoint(config.baseUrl);
        const quota = await requestJson<QuotaResponse>(config, { url, method: 'GET' });
        renderQuotaTable(quota.model_remains || [], config);
      } catch (e) {
        console.log(`  Quota fetch failed: ${(e as Error).message}`);
      }

    } catch {
      const format = detectOutputFormat(config.output);
      const result = {
        authenticated: false,
        message: 'Not authenticated.',
        hint: 'Run: minimax auth login\nOr set $MINIMAX_API_KEY',
      };
      console.log(formatOutput(result, format));
    }
  },
});
