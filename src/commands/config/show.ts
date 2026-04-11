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
  usage: 'mmx config show',
  examples: [
    'mmx config show',
    'mmx config show --output json',
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

    // Default models
    if (file.default_text_model) result.default_text_model = file.default_text_model;
    if (file.default_speech_model) result.default_speech_model = file.default_speech_model;
    if (file.default_video_model) result.default_video_model = file.default_video_model;
    if (file.default_music_model) result.default_music_model = file.default_music_model;

    console.log(formatOutput(result, format));
  },
});
