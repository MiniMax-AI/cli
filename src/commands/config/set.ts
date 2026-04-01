import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import { readConfigFile, writeConfigFile } from '../../config/loader';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';

const VALID_KEYS = ['region', 'base_url', 'output', 'timeout', 'api_key'];

export default defineCommand({
  name: 'config set',
  description: 'Set a config value',
  usage: 'minimax config set --key <key> --value <value>',
  options: [
    { flag: '--key <key>', description: 'Config key (region, base_url, output, timeout, api_key)' },
    { flag: '--value <value>', description: 'Value to set' },
  ],
  examples: [
    'minimax config set --key output --value json',
    'minimax config set --key timeout --value 600',
    'minimax config set --key base_url --value https://api-uw.minimax.io',
  ],
  async run(config: Config, flags: GlobalFlags) {
    const key = flags.key as string | undefined;
    const value = flags.value as string | undefined;

    if (!key || value === undefined) {
      throw new CLIError(
        '--key and --value are required.',
        ExitCode.USAGE,
        'minimax config set --key <key> --value <value>',
      );
    }

    if (!VALID_KEYS.includes(key)) {
      throw new CLIError(
        `Invalid config key "${key}". Valid keys: ${VALID_KEYS.join(', ')}`,
        ExitCode.USAGE,
      );
    }

    // Validate specific values
    if (key === 'region' && !['global', 'cn'].includes(value)) {
      throw new CLIError(
        `Invalid region "${value}". Valid values: global, cn`,
        ExitCode.USAGE,
      );
    }

    if (key === 'output' && !['text', 'json'].includes(value)) {
      throw new CLIError(
        `Invalid output format "${value}". Valid values: text, json`,
        ExitCode.USAGE,
      );
    }

    if (key === 'timeout') {
      const num = Number(value);
      if (isNaN(num) || num <= 0) {
        throw new CLIError(
          `Invalid timeout "${value}". Must be a positive number.`,
          ExitCode.USAGE,
        );
      }
    }

    const format = detectOutputFormat(config.output);

    if (config.dryRun) {
      console.log(formatOutput({ would_set: { [key]: value } }, format));
      return;
    }

    const existing = readConfigFile() as Record<string, unknown>;
    existing[key] = key === 'timeout' ? Number(value) : value;
    await writeConfigFile(existing);

    if (!config.quiet) {
      console.log(formatOutput({ [key]: existing[key] }, format));
    }
  },
});
