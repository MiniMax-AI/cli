import { findOptionError, scanCommandPath, parseFlags } from './args';
import { registry } from './registry';
import { GLOBAL_OPTIONS } from './command';
import { CLIError } from './errors/base';
import { ExitCode } from './errors/codes';
import { handleError } from './errors/handler';
import { loadConfig, readConfigFile } from './config/loader';
import { detectRegion, saveDetectedRegion } from './config/detect-region';
import { REGIONS, type Region } from './config/schema';
import { checkForUpdate, getPendingUpdateNotification } from './update/checker';
import { loadCredentials } from './auth/credentials';
import { ensureAuth } from './auth/setup';
import { CLI_VERSION } from './version';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  process.stderr.write('\nInterrupted. Exiting.\n');
  process.exit(130);
});

// Handle stdout EPIPE gracefully (e.g., piped to `mpv` that exits early)
process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE') process.exit(0);
  else throw e;
});

// Commands that manage their own auth or need no key
const NO_AUTH_SETUP = [
  ['auth', 'login'],
  ['auth', 'logout'],
  ['config', 'show'],
  ['config', 'set'],
  ['config', 'export-schema'],
  ['agent', 'setup'],
  ['update'],
];

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--version') || argv.includes('-v')) {
    console.log(`mmx ${CLI_VERSION}`);
    process.exit(0);
  }

  let commandPath = scanCommandPath(argv, GLOBAL_OPTIONS);
  if (commandPath[0] === 'agent') {
    const { command: agentSetupCommand } = registry.resolve(['agent', 'setup']);
    commandPath = scanCommandPath(argv, [
      ...GLOBAL_OPTIONS,
      ...(agentSetupCommand.options ?? []),
    ]);
  }

  // Proxy: env vars take precedence over config file
  const rawConfig = readConfigFile();
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy
    || process.env.ALL_PROXY || process.env.all_proxy
    || rawConfig.proxy;
  if (proxyUrl) {
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
  }

  if (argv.includes('--help') || argv.includes('-h')) {
    const ri = argv.indexOf('--region');
    const region = ((ri >= 0 && argv[ri + 1]) || process.env.MINIMAX_REGION || rawConfig.region || 'global') as Region;
    registry.printHelp(commandPath, process.stderr, region);
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
      process.stderr.write('  mmx auth login              Choose MiniMax OAuth (Global/China) or paste an API key\n');
      process.stderr.write('  mmx auth login --api-key    Save an API key directly\n\n');
    }
    process.exit(0);
  }

  const { command, extra } = registry.resolve(commandPath);
  const flagOptions = [...GLOBAL_OPTIONS, ...(command.options ?? [])];
  if (command.name === 'agent setup') {
    const optionError = findOptionError(argv, flagOptions);
    if (optionError) {
      throw new CLIError(
        optionError,
        ExitCode.USAGE,
        'Run mmx agent setup --help to see supported options.',
      );
    }
  }
  const flags = parseFlags(argv, flagOptions);

  const separatorIndex = command.name === 'agent setup' ? argv.indexOf('--') : -1;
  const positionals = separatorIndex >= 0
    ? [...extra, ...argv.slice(separatorIndex + 1)]
    : extra;
  if (positionals.length > 0) (flags as Record<string, unknown>)._positional = positionals;
  if (command.name === 'agent setup') {
    (flags as Record<string, unknown>)._hasExplicitOptions = positionals.length > 0
      || argv.some((arg) => arg.startsWith('-'));
  }

  const config = loadConfig(flags);

  const needsAuthSetup = !NO_AUTH_SETUP.some(
    (cmd) => cmd.every((c, i) => commandPath[i] === c),
  );
  if (needsAuthSetup) {
    await ensureAuth(config);
  }

  if (config.needsRegionDetection && command.name !== 'agent setup') {
    const apiKey = config.apiKey || config.fileApiKey;
    if (apiKey) {
      const detected = await detectRegion(apiKey);
      config.region = detected;
      config.baseUrl = REGIONS[detected];
      config.needsRegionDetection = false;
      await saveDetectedRegion(detected);
    }
  }

  const updateCheckPromise = command.name === 'agent setup' && config.dryRun
    ? Promise.resolve()
    : checkForUpdate(CLI_VERSION).catch(() => {});

  await command.execute(config, flags);

  await updateCheckPromise;
  const newVersion = getPendingUpdateNotification();
  if (newVersion && !config.quiet) {
    process.stderr.write(`\n  Update available: ${newVersion}\n`);
    process.stderr.write(`  npm update -g mmx-cli\n\n`);
  }
}

main().catch(handleError);
