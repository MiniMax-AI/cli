import { scanCommandPath, parseFlags } from './args';
import { registry } from './registry';
import { GLOBAL_OPTIONS } from './command';
import { handleError } from './errors/handler';
import { loadConfig } from './config/loader';
import { detectRegion, saveDetectedRegion } from './config/detect-region';
import { REGIONS } from './config/schema';
import { checkForUpdate, getPendingUpdateNotification } from './update/checker';
import { loadCredentials } from './auth/credentials';

const CLI_VERSION = process.env.CLI_VERSION ?? '0.3.1';

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--version') || argv.includes('-v')) {
    console.log(`minimax ${CLI_VERSION}`);
    process.exit(0);
  }

  const commandPath = scanCommandPath(argv);

  if (argv.includes('--help') || argv.includes('-h')) {
    registry.printHelp(commandPath, process.stderr);
    process.exit(0);
  }

  // No command: show quota if logged in, else guide to login
  if (commandPath.length === 0) {
    const { command: quotaCmd } = registry.resolve(['quota', 'show']);
    const flags = parseFlags(argv, [...GLOBAL_OPTIONS, ...(quotaCmd.options ?? [])]);
    const config = loadConfig(flags);

    const hasKey = !!(config.apiKey || config.envApiKey || config.fileApiKey);
    const hasOAuth = !!(await loadCredentials());

    if (hasKey || hasOAuth) {
      await quotaCmd.execute(config, flags);
    } else {
      process.stderr.write('\n  Not logged in.\n\n');
      process.stderr.write('  minimax auth login --api-key sk-xxxxx\n\n');
    }
    process.exit(0);
  }

  const { command, extra } = registry.resolve(commandPath);
  const flags = parseFlags(argv, [...GLOBAL_OPTIONS, ...(command.options ?? [])]);

  if (extra.length > 0) (flags as Record<string, unknown>)._positional = extra;

  const config = loadConfig(flags);

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

  const updateCheckPromise = checkForUpdate(CLI_VERSION).catch(() => {});

  await command.execute(config, flags);

  await updateCheckPromise;
  const newVersion = getPendingUpdateNotification();
  if (newVersion && !config.quiet) {
    process.stderr.write(`\n  Update available: v${CLI_VERSION} → ${newVersion}\n`);
    process.stderr.write(`  Run 'minimax update' to upgrade.\n\n`);
  }
}

main().catch(handleError);
