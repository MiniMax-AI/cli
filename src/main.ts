import { parseArgs } from './args';
import { registry } from './registry';
import { handleError } from './errors/handler';
import { loadConfig } from './config/loader';
import { detectRegion, saveDetectedRegion } from './config/detect-region';
import { REGIONS } from './config/schema';
import { checkForUpdate, getPendingUpdateNotification } from './update/checker';

const CLI_VERSION = process.env.CLI_VERSION ?? '0.3.1';

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--version') || args.includes('-v')) {
    console.log(`minimax ${CLI_VERSION}`);
    process.exit(0);
  }

  const { commandPath, flags } = parseArgs(args);

  if (flags.help || commandPath.length === 0) {
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
