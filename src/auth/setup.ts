import type { Config } from '../config/schema';
import { readConfigFile, writeConfigFile } from '../config/loader';
import { promptText, promptConfirm } from '../utils/prompt';
import { isInteractive } from '../utils/env';
import { maskToken } from '../utils/token';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';

export async function ensureApiKey(config: Config): Promise<void> {
  if (config.apiKey || config.fileApiKey) return;

  const envKey = process.env.MINIMAX_API_KEY;
  let key: string | undefined;

  if (envKey) {
    if (!isInteractive({ nonInteractive: config.nonInteractive })) {
      key = envKey;
    } else {
      const use = await promptConfirm({
        message: `Found MINIMAX_API_KEY in environment (${maskToken(envKey)}). Save it to config file?`,
      });
      if (use) key = envKey;
    }
  }

  if (!key) {
    if (!isInteractive({ nonInteractive: config.nonInteractive })) {
      throw new CLIError(
        'No API key found.',
        ExitCode.AUTH,
        'Set env var:    export MINIMAX_API_KEY=sk-xxxxx\nPass directly:  --api-key sk-xxxxx',
      );
    }
    const input = await promptText({ message: 'Enter your MiniMax API key:' });
    if (!input) throw new CLIError('API key is required.', ExitCode.AUTH);
    key = input;
  }

  const data = { ...(readConfigFile() as Record<string, unknown>), api_key: key };
  await writeConfigFile(data);
  config.fileApiKey = key;

  const path = config.configPath ?? '~/.minimax/config.json';
  process.stderr.write(`API key saved to ${path}\n`);
}
