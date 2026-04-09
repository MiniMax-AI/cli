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

    const url = quotaEndpoint(config.baseUrl);
    const response = await requestJson<QuotaApiResponse>(config, { url });
    const models = response.model_remains || [];
    const format = detectOutputFormat(flags.output as string | undefined);

    // API field current_interval_usage_count actually holds the remaining quota (not usage).
    // Fix values in-place so the JSON output is semantically correct with no schema change.
    const fixedModels = models.map((m) => ({
      ...m,
      current_interval_usage_count: m.current_interval_total_count - m.current_interval_usage_count,
      current_weekly_usage_count: m.current_weekly_total_count - m.current_weekly_usage_count,
    }));

    if (format !== 'text') {
      console.log(formatOutput({ ...response, model_remains: fixedModels }, format));
      return;
    }

    if (config.quiet) {
      for (const m of fixedModels) {
        const used = m.current_interval_usage_count; // already usage after fix
        console.log(`${m.model_name}\t${used}\t${m.current_interval_total_count}\t${m.current_interval_total_count - used}`);
      }
      return;
    }

    renderQuotaTable(fixedModels, config);
  },
});
