import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { parseConfigFile, REGIONS, type Config, type ConfigFile, type Region } from './schema';
import { ensureConfigDir, getConfigPath, getLegacyConfigPath } from './paths';
import { detectOutputFormat, type OutputFormat } from '../output/formatter';
import type { GlobalFlags } from '../types/flags';

function migrateLegacyConfig(): void {
  const legacy = getLegacyConfigPath();
  const current = getConfigPath();
  if (existsSync(legacy) && !existsSync(current)) {
    try {
      // Parse YAML by hand — only need simple key: value pairs
      const raw = readFileSync(legacy, 'utf-8');
      const obj: Record<string, string> = {};
      for (const line of raw.split('\n')) {
        const m = line.match(/^(\w+):\s*(.+)$/);
        if (m) obj[m[1]!] = m[2]!.trim();
      }
      writeFileSync(current, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
      renameSync(legacy, legacy + '.bak');
    } catch { /* silent */ }
  }
}

export function readConfigFile(): ConfigFile {
  migrateLegacyConfig();
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
  const envApiKey = process.env.MINIMAX_API_KEY || undefined;
  const fileApiKey = file.api_key;

  const explicitRegion = (flags.region as string) || process.env.MINIMAX_REGION || undefined;
  const cachedRegion = file.region;
  const region = (explicitRegion || cachedRegion || 'global') as Region;

  // Re-detect if: no explicit region AND (no cached region OR key fingerprint changed)
  const activeKey = apiKey || fileApiKey || envApiKey;
  const keyFingerprint = activeKey ? activeKey.slice(0, 8) : undefined;
  const needsRegionDetection = !explicitRegion
    && (!cachedRegion || (keyFingerprint !== undefined && keyFingerprint !== file.region_key_fingerprint));

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
    envApiKey,
    fileApiKey,
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
