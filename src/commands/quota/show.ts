import { defineCommand } from '../../command';
import { requestJson } from '../../client/http';
import { quotaEndpoint } from '../../client/endpoints';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import { renderQuotaTable } from '../../output/quota-table';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';
import type { QuotaModelRemain } from '../../types/api';

interface QuotaApiResponse {
  model_remains: QuotaModelRemain[];
}

export default defineCommand({
  name: 'quota show',
  description: 'Display Token Plan usage and remaining quotas',
  usage: 'minimax quota show',
  examples: [
    'minimax quota show',
    'minimax quota show --output json',
  ],
  async run(config: Config, flags: GlobalFlags) {
    if (config.dryRun) {
      console.log('Would fetch quota information.');
      return;
    }

    const url = quotaEndpoint(config.baseUrl);
    const response = await requestJson<QuotaApiResponse>(config, { url });
    const models = response.model_remains || [];
    const format = detectOutputFormat(flags.output as string | undefined);

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

    renderQuotaTable(models, config);
  },
});
