import type { Config } from '../config/schema';
import { homedir } from 'os';
import { maskToken } from '../utils/token';

let printed = false;

export function resetStatusBar(): void {
  printed = false;
}

const reset    = '\x1b[0m';
const dim      = '\x1b[2m';
const bold     = '\x1b[1m';
const mmBlue   = '\x1b[38;2;43;82;255m';
const mmPurple = '\x1b[38;2;147;51;234m';
const mmCyan   = '\x1b[38;2;6;184;212m';
const mmPink   = '\x1b[38;2;236;72;153m';

function tildePath(p: string): string {
  return p.startsWith(homedir()) ? p.replace(homedir(), '~') : p;
}

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

export function maybeShowStatusBar(config: Config, token: string, model?: string): void {
  if (config.quiet || printed || !process.stderr.isTTY) return;
  printed = true;

  const filePath   = config.configPath ? tildePath(config.configPath) : '~/.mmx/config.json';
  const baseUrlStr = stripScheme(config.baseUrl);
  const keySrc     = config.apiKeySource === 'env'
    ? '(env)'
    : config.apiKey
      ? '(flag)'
      : '(file)';
  const maskedKey  = maskToken(token);
  const modelStr   = model ? ` ${dim}|${reset} ${dim}Model:${reset} ${mmPurple}${model}${reset}` : '';

  process.stderr.write(
    `${bold}${mmBlue}MINIMAX${reset} ` +
    `${dim}${filePath}${reset} ` +
    `${dim}|${reset} ` +
    `${dim}URL:${reset} ${mmCyan}${baseUrlStr}${reset} ` +
    `${dim}|${reset} ` +
    `${dim}Key:${reset} ${mmPink}${maskedKey}${reset} ${dim}${keySrc}${reset}` +
    `${modelStr}\n`,
  );
}
