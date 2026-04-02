import { readFileSync, writeFileSync, existsSync } from 'fs';
import { parseConfigFile, REGIONS, type Config, type ConfigFile, type Region } from './schema';
import { ensureConfigDir, getConfigPath } from './paths';
import { detectOutputFormat, type OutputFormat } from '../output/formatter';
import type { GlobalFlags } from '../types/flags';

export function readConfigFile(): ConfigFile {
  const path = getConfigPath();
  if (!existsSync(path)) return {};
  try {
    return parseConfigFile(JSON.parse(readFileSync(path, 'utf-8')));
  } catch {
    return {};
  }
}

export async function writeConfigFile(data: Record<string, unknown>): Promise<void> {
  await ensureConfigDir();
  writeFileSync(getConfigPath(), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
}

export function loadConfig(flags: GlobalFlags): Config {
  const file = readConfigFile();

  const apiKey = flags.apiKey || undefined;
  const fileApiKey = file.api_key;

  const explicitRegion = (flags.region as string) || process.env.MINIMAX_REGION || undefined;
  const cachedRegion = file.region;
  const region = (explicitRegion || cachedRegion || 'global') as Region;

  const activeKey = apiKey || fileApiKey;
  const needsRegionDetection = !explicitRegion
    && (!cachedRegion || (activeKey !== undefined && activeKey !== file.api_key));

  const baseUrl = flags.baseUrl
    || process.env.MINIMAX_BASE_URL
    || file.base_url
    || REGIONS[region]
    || REGIONS.global;

  const output: OutputFormat = detectOutputFormat(
    flags.output || process.env.MINIMAX_OUTPUT || file.output,
  );

  const timeout = flags.timeout
    ?? (process.env.MINIMAX_TIMEOUT ? Number(process.env.MINIMAX_TIMEOUT) : undefined)
    ?? file.timeout
    ?? 300;

  return {
    apiKey,
    fileApiKey,
    fileRegion: file.region,
    configPath: getConfigPath(),
    region,
    baseUrl,
    output,
    timeout,
    verbose: flags.verbose || process.env.MINIMAX_VERBOSE === '1',
    quiet: flags.quiet || false,
    noColor: flags.noColor || process.env.NO_COLOR !== undefined || !process.stdout.isTTY,
    yes: flags.yes || false,
    dryRun: flags.dryRun || false,
    nonInteractive: flags.nonInteractive || false,
    async: flags.async || false,
    needsRegionDetection,
  };
}
