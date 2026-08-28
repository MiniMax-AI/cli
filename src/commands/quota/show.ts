import { defineCommand } from '../../command';
import { requestJson } from '../../client/http';
import { selectUsageEndpoint } from '../../client/endpoints';
import { resolveCredential } from '../../auth/resolver';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import { renderUsage } from '../../output/usage';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { AccountBalanceResponse, QuotaResponse } from '../../types/api';

export default defineCommand({
  name: 'quota show',
  description: 'Display Token Plan usage and remaining quotas',
  usage: 'mmx quota show',
  examples: [
    'mmx quota show',
    'mmx quota show --output json',
  ],
  async run(config: Config, flags: GlobalFlags) {
    if (config.dryRun) {
      console.log('Would fetch quota information.');
      return;
    }

    const format = detectOutputFormat(flags.output as string | undefined);
    const credential = await resolveCredential(config);
    const endpoint = selectUsageEndpoint(config.baseUrl, credential);

    if (endpoint.kind === 'account-balance') {
      const response = await requestJson<AccountBalanceResponse>(config, { url: endpoint.url });
      if (format !== 'text') {
        console.log(formatOutput(response, format));
        return;
      }
      renderUsage(response, config, credential.token);
      return;
    }

    const response = await requestJson<QuotaResponse>(config, { url: endpoint.url });
    const models = response.model_remains || [];

    if (format !== 'text') {
      console.log(formatOutput(response, format));
      return;
    }

    if (config.quiet) {
      for (const m of models) {
        const remaining = m.current_interval_total_count - m.current_interval_usage_count;
        console.log(`${m.model_name}\t${m.current_interval_usage_count}\t${m.current_interval_total_count}\t${remaining}`);
      }
      return;
    }

    renderUsage(response, config);
  },
});
