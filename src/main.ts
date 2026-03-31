import { parseArgs } from './args';
import { registry } from './registry';
import { handleError } from './errors/handler';
import { loadConfig } from './config/loader';
import { detectRegion, saveDetectedRegion } from './config/detect-region';
import { REGIONS } from './config/schema';
import { checkForUpdate, getPendingUpdateNotification } from './update/checker';
import { resolveCredential } from './auth/resolver';
import { requestJson } from './client/http';
import { quotaEndpoint } from './client/endpoints';
import { createSpinner } from './output/progress';
import type { Config } from './config/schema';
import type { QuotaResponse } from './types/api';

const CLI_VERSION = process.env.CLI_VERSION ?? '0.3.1';

// ── ANSI color constants (MiniMax brand palette) ──
const R  = '\x1b[0m';
const B  = '\x1b[1m';
const D  = '\x1b[2m';
const MM_BLUE  = '\x1b[38;2;43;82;255m';
const MM_CYAN  = '\x1b[38;2;6;184;212m';
const FG_GREEN  = '\x1b[38;2;74;222;128m';
const FG_YELLOW = '\x1b[38;2;250;204;21m';
const FG_RED    = '\x1b[38;2;248;113;113m';
const WHITE     = '\x1b[38;2;255;255;255m';

function c(color: string, text: string): string {
  return `${color}${text}${R}`;
}

const BANNER = `
${c(B + MM_BLUE, '  __  __ ___ _   _ ___ __  __    _   __  __')}
${c(B + MM_BLUE, ' |  \\/  |_ _| \\ | |_ _|  \\/  |  / \\ \\ \\ \\/ /')}
${c(B + MM_BLUE, ' | |\\/| || ||  \\| || || |\\/| | / _ \\ \\  /')}
${c(B + MM_BLUE, ' | |  | || || |\\  || || |  | |/ ___ \\/  \\')}
${c(B + MM_BLUE, ' |_|  |_|___|_| \\_|___|_|  |_/_/   \\_\\_/\\_\\')}
${c(D, `                                             v${CLI_VERSION}`)}
`;

const COMMON_COMMANDS = [
  ['text chat',       'Chat with a LLM'],
  ['vision describe', 'Image understanding'],
  ['image generate',  'Generate an image'],
  ['video generate',  'Generate a video'],
];

async function printDashboard(config: Config): Promise<void> {
  const useColor = process.stdout.isTTY && !config.noColor;

  // Try to resolve credentials; if not found we're logged-out
  let credential: Awaited<ReturnType<typeof resolveCredential>> | null = null;
  try {
    credential = await resolveCredential(config);
  } catch {
    // Not logged in
  }

  if (credential) {
    // ── Logged-in dashboard ──
    const maskedKey = credential.token.length > 8
      ? `${credential.token.slice(0, 4)}...${credential.token.slice(-4)}`
      : '****';
    const region = config.region ?? 'global';
    const keySource = credential.source === 'credentials.json'
      ? 'OAuth'
      : credential.source === 'config.yaml'
        ? 'CONFIG'
        : credential.source === 'env'
          ? 'ENV'
          : 'FLAG';

    process.stdout.write(BANNER);

    const keyRow = `  ${c(D, 'Key:')}     ${useColor ? c(B + WHITE, maskedKey) : maskedKey}  ${c(D, `(${keySource})`)}`;
    const regionRow = `  ${c(D, 'Region:')}  ${useColor ? c(MM_CYAN, region) : region}`;
    process.stdout.write(keyRow + '\n');
    process.stdout.write(regionRow + '\n');

    // Fetch quota with spinner
    process.stdout.write('\n');
    const spinner = createSpinner('Fetching quota...');
    if (useColor) spinner.start();

    let quotaFailed = false;
    let models: QuotaResponse['model_remains'] = [];
    try {
      const url = quotaEndpoint(config.baseUrl);
      const resp = await requestJson<QuotaResponse>(config, { url });
      models = resp.model_remains ?? [];
    } catch {
      quotaFailed = true;
    }
    spinner.stop();

    if (quotaFailed) {
      process.stdout.write(`  ${c(FG_YELLOW, '⚠ Quota unavailable (network error or timeout)')}\n`);
    } else if (models.length > 0) {
      const limit = models[0]!.current_interval_total_count;
      const remaining = models[0]!.current_interval_usage_count;  // this IS the remaining count per API
      const used = limit - remaining;
      const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;  // % of quota consumed
      const bar = renderMiniBar(pct, useColor);
      process.stdout.write(`  ${c(D, 'Balance:')}  ${useColor ? c(pctColor(pct), `${remaining.toLocaleString()} ${c(D, '/')} ${limit.toLocaleString()}`) : `${remaining} / ${limit}`}  ${bar}  ${pct}%\n`);
      if (models.length > 1) {
        process.stdout.write(`  ${c(D, `+${models.length - 1} more models → 'minimax quota show'`)}\n`);
      }
    }

    process.stdout.write('\n');
    process.stdout.write(c(D, '  Common commands:\n'));
    for (const [cmd, desc] of COMMON_COMMANDS) {
      // Left-aligned: 2-space indent, command padded, 2-space gap, description
      const label = useColor ? c(B + WHITE, cmd) : cmd;
      process.stdout.write(`  ${label.padEnd(24)}  ${c(D, desc)}\n`);
    }
    process.stdout.write('\n');
    process.stdout.write(`  ${c(D, "Run 'minimax <command> --help' for details.")}\n`);
    process.stdout.write(`  ${c(D, "Or 'minimax --help' for the full command list.")}\n`);

  } else {
    // ── Logged-out dashboard ──
    process.stdout.write(BANNER);
    process.stdout.write(`\n  ${c(FG_RED, '✗ Not authenticated yet')}\n`);
    process.stdout.write(`\n  ${c(D, "You're not logged in. To get started:")}\n`);
    process.stdout.write(`\n  ${c(MM_CYAN, 'minimax auth login --api-key sk-xxxxx')}\n`);
    process.stdout.write(`  ${c(D, '← Paste your Token Plan API key (sk-cp-...)')}\n`);
    process.stdout.write(`\n  ${c(D, 'Or set the environment variable:')}\n`);
    process.stdout.write(`  ${c(D, 'export MINIMAX_API_KEY=sk-xxxxx')}\n`);
    process.stdout.write(`\n  ${c(D, 'What you can do:')}\n`);
    const capabilities = [
      ['text chat',       'Chat with any MiniMax model'],
      ['vision describe', 'Image understanding (VLM)'],
      ['image generate',  'Image generation (image-01)'],
      ['video generate',  'Video generation (Hailuo series)'],
    ];
    for (const [cmd, desc] of capabilities) {
      const label = useColor ? c(B + WHITE, cmd) : cmd;
      process.stdout.write(`  ${label.padEnd(24)}  ${c(D, desc)}\n`);
    }
    process.stdout.write('\n');
    process.stdout.write(`  ${c(D, "Run 'minimax --help' for the full command list.")}\n`);
  }
}

function renderMiniBar(pct: number, color: boolean): string {
  const W = 10;
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * W);
  const empty = W - filled;
  if (!color) return `[${'█'.repeat(filled)}${'-'.repeat(empty)}]`;
  return `${c(FG_GREEN, '█'.repeat(filled))}${c(D, '-'.repeat(empty))}`;
}

function pctColor(pct: number): string {
  if (pct > 50) return FG_GREEN;
  if (pct > 20) return FG_YELLOW;
  return FG_RED;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--version') || args.includes('-v')) {
    console.log(`minimax ${CLI_VERSION}`);
    process.exit(0);
  }

  const { commandPath, flags } = parseArgs(args);

  // ── Dashboard: no subcommand given (distinct from --help) ──
  if (commandPath.length === 0 && !flags.help) {
    const config = loadConfig(flags);
    await printDashboard(config);
    process.exit(0);
  }

  if (flags.help) {
    registry.printHelp(commandPath, process.stderr);
    process.exit(0);
  }

  const { command, extra } = registry.resolve(commandPath);
  if (extra.length > 0) (flags as Record<string, unknown>)._positional = extra;

  const config = loadConfig(flags);

  // Auto-detect region when no explicit region is set and the API key has changed
  if (config.needsRegionDetection) {
    const apiKey = config.apiKey || config.fileApiKey || config.envApiKey;
    if (apiKey) {
      const detected = await detectRegion(apiKey);
      config.region = detected;
      config.baseUrl = REGIONS[detected];
      config.needsRegionDetection = false;
      await saveDetectedRegion(detected, apiKey.slice(0, 8));
    }
  }

  // Fire-and-forget update check (non-blocking)
  const updateCheckPromise = checkForUpdate(CLI_VERSION).catch(() => {});

  await command.execute(config, flags);

  // After command finishes, flush the update check and notify if needed
  await updateCheckPromise;
  const newVersion = getPendingUpdateNotification();
  if (newVersion && !config.quiet) {
    process.stderr.write(`\n  Update available: v${CLI_VERSION} → ${newVersion}\n`);
    process.stderr.write(`  Run 'minimax update' to upgrade.\n\n`);
  }
}

main().catch(handleError);
