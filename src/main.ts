import { scanCommandPath, parseFlags } from './args';
import { registry } from './registry';
import { GLOBAL_OPTIONS } from './command';
import { handleError } from './errors/handler';
import { loadConfig } from './config/loader';
import { detectRegion, saveDetectedRegion } from './config/detect-region';
import { REGIONS } from './config/schema';
import { checkForUpdate, getPendingUpdateNotification } from './update/checker';
import { loadCredentials } from './auth/credentials';
import { ensureApiKey } from './auth/setup';

const CLI_VERSION = process.env.CLI_VERSION ?? '0.3.1';

// Commands that manage their own auth or need no key
const NO_AUTH_SETUP = [
  ['auth', 'login'],
  ['auth', 'logout'],
  ['config', 'show'],
  ['config', 'set'],
  ['config', 'export-schema'],
  ['update'],
];

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

  // No command: help + quota (if logged in) or login guide
  if (commandPath.length === 0) {
    registry.printHelp([], process.stderr);

    const { command: quotaCmd } = registry.resolve(['quota', 'show']);
    const flags = parseFlags(argv, [...GLOBAL_OPTIONS, ...(quotaCmd.options ?? [])]);
    const config = loadConfig(flags);

    const hasKey = !!(config.apiKey || config.fileApiKey);
    const hasOAuth = !!(await loadCredentials());

    if (hasKey || hasOAuth) {
      await quotaCmd.execute(config, flags);
    } else {
      process.stderr.write('  Not logged in.\n');
      process.stderr.write('  minimax auth login --api-key sk-xxxxx\n\n');
    }
    process.exit(0);
  }

  const { command, extra } = registry.resolve(commandPath);
  const flags = parseFlags(argv, [...GLOBAL_OPTIONS, ...(command.options ?? [])]);

  if (extra.length > 0) (flags as Record<string, unknown>)._positional = extra;

  const config = loadConfig(flags);

  const needsAuthSetup = !NO_AUTH_SETUP.some(
    (cmd) => cmd.every((c, i) => commandPath[i] === c),
  );
  if (needsAuthSetup) {
    await ensureApiKey(config);
  }

  if (config.needsRegionDetection) {
    const apiKey = config.apiKey || config.fileApiKey;
    if (apiKey) {
      const detected = await detectRegion(apiKey);
      config.region = detected;
      config.baseUrl = REGIONS[detected];
      config.needsRegionDetection = false;
      await saveDetectedRegion(detected);
    }
  }

  const updateCheckPromise = checkForUpdate(CLI_VERSION).catch(() => {});

  await command.execute(config, flags);

  await updateCheckPromise;
  const newVersion = getPendingUpdateNotification();
  if (newVersion && !config.quiet) {
    process.stderr.write(`\n  Update available: ${newVersion}\n`);
    process.stderr.write(`  npm update -g minimax-cli\n\n`);
  }
}

main().catch(handleError);
