import type { Config, Region } from '../config/schema';
import { REGIONS } from '../config/schema';
import { readConfigFile, writeConfigFile } from '../config/loader';
import { promptText, promptConfirm } from '../utils/prompt';
import { isInteractive } from '../utils/env';
import { maskToken } from '../utils/token';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import { deviceCodeLogin } from './oauth';
import { loadCredentials } from './credentials';
import { buildNoCredentialsHint } from './hints';

interface AuthChoice {
  value: 'oauth-global' | 'oauth-cn' | 'api-key';
  label: string;
}

const AUTH_CHOICES: AuthChoice[] = [
  { value: 'oauth-global', label: `MiniMax (OAuth login → ${stripScheme(REGIONS.global)})` },
  { value: 'oauth-cn',     label: `MiniMax (OAuth login → ${stripScheme(REGIONS.cn)})` },
  { value: 'api-key',      label: `API key (${stripScheme(REGIONS.global)} or ${stripScheme(REGIONS.cn)})` },
];

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

export async function ensureAuth(config: Config): Promise<void> {
  if (config.apiKey || config.fileApiKey) return;
  if (await loadCredentials()) return;

  const envKey = process.env.MINIMAX_API_KEY;
  if (envKey) {
    if (!isInteractive({ nonInteractive: config.nonInteractive })) {
      return; // env key is enough; no prompt
    }
    const save = await promptConfirm({
      message: `Found MINIMAX_API_KEY in environment (${maskToken(envKey)}). Save to config file?`,
    });
    if (save) {
      await persistApiKey(config, envKey);
    }
    return;
  }

  if (!isInteractive({ nonInteractive: config.nonInteractive })) {
    throw new CLIError(
      'No credentials found.',
      ExitCode.AUTH,
      buildNoCredentialsHint(config.configPath),
    );
  }

  const choice = await pickAuthMethod();
  if (choice === 'api-key') {
    const input = await promptText({ message: 'Enter your MiniMax API key:' });
    if (!input) throw new CLIError('API key is required.', ExitCode.AUTH);
    await persistApiKey(config, input);
    return;
  }

  await runOAuthLogin(choice === 'oauth-cn' ? 'cn' : 'global');
}

export async function pickAuthMethod(): Promise<AuthChoice['value']> {
  const { select, isCancel } = await import('@clack/prompts');
  const value = await select({
    message: 'How would you like to authenticate?',
    options: AUTH_CHOICES.map(c => ({ value: c.value, label: c.label })),
  });
  if (isCancel(value)) throw new CLIError('Authentication cancelled.', ExitCode.AUTH);
  return value as AuthChoice['value'];
}

/**
 * Region-only picker used by `mmx auth login --recommend` (no API-key option).
 */
export async function pickOAuthRegion(): Promise<Region> {
  const { select, isCancel } = await import('@clack/prompts');
  const value = await select({
    message: 'Select an OAuth region:',
    options: [
      { value: 'global', label: `Global  →  ${stripScheme(REGIONS.global)}` },
      { value: 'cn',     label: `China   →  ${stripScheme(REGIONS.cn)}` },
    ],
  });
  if (isCancel(value)) throw new CLIError('Authentication cancelled.', ExitCode.AUTH);
  return value as Region;
}

export async function runOAuthLogin(region: Region): Promise<void> {
  const creds = await deviceCodeLogin(region);
  // OAuth and api_key are mutually exclusive — drop any stale api_key
  // so `mmx auth status` and the resolver see a single source of truth.
  const existing = readConfigFile() as Record<string, unknown>;
  delete existing.api_key;
  existing.oauth = creds;
  existing.region = region;
  await writeConfigFile(existing);
  process.stderr.write('Logged in successfully.\n');
  process.stderr.write('Credentials saved to ~/.mmx/config.json\n');
}

async function persistApiKey(config: Config, key: string): Promise<void> {
  const data = { ...(readConfigFile() as Record<string, unknown>), api_key: key };
  await writeConfigFile(data);
  config.fileApiKey = key;
  process.stderr.write(`API key saved to ${config.configPath ?? '~/.mmx/config.json'}\n`);
}

// Legacy alias kept so main.ts keeps working without churn.
export const ensureApiKey = ensureAuth;
