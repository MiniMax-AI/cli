import { defineCommand } from '../../command';
import { CLIError } from '../../errors/base';
import { ExitCode } from '../../errors/codes';
import { formatOutput, detectOutputFormat } from '../../output/formatter';
import { readConfigFile, writeConfigFile } from '../../config/loader';
import type { Config } from '../../config/schema';
import type { GlobalFlags } from '../../types/flags';

const VALID_KEYS = ['region', 'base_url', 'output', 'timeout', 'api_key', 'default_text_model', 'default_speech_model', 'default_video_model', 'default_music_model'];

// Allow hyphen-style keys (e.g. default-text-model → default_text_model)
const KEY_ALIASES: Record<string, string> = {
  'default-text-model': 'default_text_model',
  'default-speech-model': 'default_speech_model',
  'default-video-model': 'default_video_model',
  'default-music-model': 'default_music_model',
};

export default defineCommand({
  name: 'config set',
  description: 'Set a config value',
  usage: 'mmx config set --key <key> --value <value>',
  options: [
    { flag: '--key <key>', description: 'Config key (region, base_url, output, timeout, api_key, default_text_model, default_speech_model, default_video_model, default_music_model)' },
    { flag: '--value <value>', description: 'Value to set' },
  ],
  examples: [
    'mmx config set --key output --value json',
    'mmx config set --key timeout --value 600',
    'mmx config set --key base_url --value https://api-uw.minimax.io',
  ],
  async run(config: Config, flags: GlobalFlags) {
    const key = flags.key as string | undefined;
    const value = flags.value as string | undefined;

    if (!key || value === undefined) {
      throw new CLIError(
        '--key and --value are required.',
        ExitCode.USAGE,
        'mmx config set --key <key> --value <value>',
      );
    }

    // Resolve hyphen aliases to underscore keys
    const resolvedKey: string = KEY_ALIASES[key] || key;

    if (!VALID_KEYS.includes(resolvedKey)) {
      throw new CLIError(
        `Invalid config key "${key}". Valid keys: ${VALID_KEYS.join(', ')}`,
        ExitCode.USAGE,
      );
    }

    // Validate specific values
    if (resolvedKey === 'region' && !['global', 'cn'].includes(value)) {
      throw new CLIError(
        `Invalid region "${value}". Valid values: global, cn`,
        ExitCode.USAGE,
      );
    }

    if (resolvedKey === 'output' && !['text', 'json'].includes(value)) {
      throw new CLIError(
        `Invalid output format "${value}". Valid values: text, json`,
        ExitCode.USAGE,
      );
    }

    if (resolvedKey === 'timeout') {
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
      console.log(formatOutput({ would_set: { [resolvedKey]: value } }, format));
      return;
    }

    const existing = readConfigFile() as Record<string, unknown>;
    existing[resolvedKey] = resolvedKey === 'timeout' ? Number(value) : value;
    await writeConfigFile(existing);

    if (!config.quiet) {
      console.log(formatOutput({ [resolvedKey]: existing[resolvedKey] }, format));
    }
  },
});
