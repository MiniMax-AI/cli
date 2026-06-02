import { readFileSync, writeFileSync, renameSync, existsSync, copyFileSync, unlinkSync } from 'fs';
import { parseConfigFile, REGIONS, type Config, type ConfigFile, type Region } from './schema';
import { ensureConfigDir, getConfigPath } from './paths';
import { detectOutputFormat, type OutputFormat } from '../output/formatter';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';
import type { GlobalFlags } from '../types/flags';

/**
 * Write `content` to `target` atomically when possible. The file is first
 * written to `target + '.tmp'` and then renamed into place. On `EXDEV`
 * (cross-device link not permitted — e.g. Windows when the temp dir is on
 * a different drive than the config dir, or *nix when $TMPDIR is on a
 * different mount than $HOME), fall back to copyFileSync + unlinkSync.
 * The fallback is not atomic, but a concurrent reader will see either
 * the old file or the fully-written new file — never a partial write.
 */
function atomicWriteFileSync(target: string, content: string): void {
  const tmp = target + '.tmp';
  writeFileSync(tmp, content, { mode: 0o600 });
  try {
    renameSync(tmp, target);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'EXDEV') {
      copyFileSync(tmp, target);
      unlinkSync(tmp);
    } else {
      throw err;
    }
  }
}

export function readConfigFile(): ConfigFile {
  const path = getConfigPath();
  if (!existsSync(path)) return {};
  try {
    return parseConfigFile(JSON.parse(readFileSync(path, 'utf-8')));
  } catch (err) {
    const e = err as Error;
    if (e instanceof SyntaxError || e.message.includes('JSON')) {
      process.stderr.write(`Warning: config file is corrupted. Run 'mmx config set' to reset.\n`);
    }
    return {};
  }
}

export async function writeConfigFile(data: Record<string, unknown>): Promise<void> {
  await ensureConfigDir();
  const path = getConfigPath();
  atomicWriteFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

export function loadConfig(flags: GlobalFlags): Config {
  const file = readConfigFile();

  const apiKey = flags.apiKey || undefined;
  const fileApiKey = file.api_key;

  const explicitRegion = (flags.region as string) || process.env.MINIMAX_REGION || undefined;
  if (explicitRegion && !(explicitRegion in REGIONS)) {
    throw new CLIError(
      `Invalid region "${explicitRegion}". Valid values: ${Object.keys(REGIONS).join(', ')}`,
      ExitCode.USAGE,
    );
  }

  const cachedRegion = file.region;
  const region = (explicitRegion || cachedRegion || 'global') as Region;

  const activeKey = apiKey || fileApiKey;
  const needsRegionDetection = !explicitRegion
    && (!cachedRegion || (activeKey !== undefined && activeKey !== file.api_key));

  const baseUrl = flags.baseUrl
    || process.env.MINIMAX_BASE_URL
    || file.base_url
    || file.oauth?.resource_url
    || REGIONS[region]
    || REGIONS.global;

  const output: OutputFormat = detectOutputFormat(
    flags.output || process.env.MINIMAX_OUTPUT || file.output,
  );

  const envTimeout = process.env.MINIMAX_TIMEOUT ? Number(process.env.MINIMAX_TIMEOUT) : undefined;
  const validEnvTimeout = envTimeout !== undefined && Number.isFinite(envTimeout) && envTimeout > 0
    ? envTimeout : undefined;
  const timeout = flags.timeout ?? validEnvTimeout ?? file.timeout ?? 300;

  return {
    apiKey,
    fileApiKey,
    fileRegion: file.region,
    configPath: getConfigPath(),
    region,
    baseUrl,
    output,
    timeout,
    defaultTextModel: file.default_text_model,
    defaultSpeechModel: file.default_speech_model,
    defaultVideoModel: file.default_video_model,
    defaultMusicModel: file.default_music_model,
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
