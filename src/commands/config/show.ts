import { defineCommand } from '../../command';
import { readConfigFile as loadConfigFile } from '../../config/loader';
import { getConfigPath } from '../../config/paths';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import { maskToken } from '../../utils/token';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';

export default defineCommand({
  name: 'config show',
  description: 'Display current configuration',
  usage: 'minimax config show',
  examples: [
    'minimax config show',
    'minimax config show --output json',
  ],
  async run(config: Config, _flags: GlobalFlags) {
    const file = loadConfigFile();
    const format = detectOutputFormat(config.output);

    const result: Record<string, unknown> = {
      region: config.region,
      base_url: config.baseUrl,
      output: config.output,
      timeout: config.timeout,
      config_file: getConfigPath(),
    };

    // Mask API key if present
    if (file.api_key) {
      result.api_key = maskToken(file.api_key);
    }

    console.log(formatOutput(result, format));
  },
});
